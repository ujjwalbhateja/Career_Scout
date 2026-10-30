"""Explicit tool registration, schema validation, scope, timeout and per-run budget."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from importlib.resources import files

from pydantic import BaseModel, ValidationError

from career_scout.contracts import AgentId, RunContext
from career_scout.policy import WorkflowError


@dataclass(frozen=True)
class ToolSpec:
    name: str
    owner: AgentId
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    description: str
    side_effect: str = "none"


@dataclass(frozen=True)
class Invocation:
    context: RunContext
    agent: AgentId
    prompt: str


Handler = Callable[[BaseModel, Invocation], Awaitable[BaseModel | dict]]


def read_prompt(agent: str) -> str:
    # Fixed caller-selected agent IDs only; no caller-controlled filesystem paths.
    from career_scout.policy import PROFILE_CHILDREN, TOP_LEVEL

    if agent not in (*PROFILE_CHILDREN, *TOP_LEVEL, "master", "application-storage"):
        raise ValueError("Unknown prompt")
    package = agent.replace("-", "_")
    return files(f"career_scout.agents.{package}").joinpath("prompt.md").read_text("utf-8")


class ToolRegistry:
    def __init__(self, specs: tuple[ToolSpec, ...]):
        if len({spec.name for spec in specs}) != len(specs):
            raise ValueError("Duplicate tool contract")
        self.specs = {spec.name: spec for spec in specs}
        self._handlers: dict[str, Handler] = {}

    def bind(self, name: str, handler: Handler) -> None:
        if name not in self.specs:
            raise ValueError("Declare a tool contract before binding its implementation")
        if name in self._handlers:
            raise ValueError("Tool already bound")
        self._handlers[name] = handler

    def session(self, context: RunContext) -> "ToolSession":
        return ToolSession(self.specs.copy(), self._handlers.copy(), context)


class ToolSession:
    """Created per run. Counts cannot leak across users or concurrent invocations."""

    def __init__(self, specs, handlers, context):
        self.specs, self.handlers, self.context = specs, handlers, context
        self.calls = 0

    async def call(self, agent: AgentId, name: str, payload: BaseModel):
        spec = self.specs.get(name)
        if spec is None or spec.owner != agent:
            raise WorkflowError("tool_denied", "Tool not available to this agent")
        if name not in self.handlers:
            raise WorkflowError("not_implemented", f"Bind the {name} adapter before using {agent}.")
        if self.calls >= self.context.max_tool_calls:
            raise WorkflowError("budget_exhausted", "The run's tool-call budget is exhausted.")
        try:
            request = spec.input_model.model_validate(payload.model_dump())
        except (ValidationError, AttributeError):
            raise WorkflowError("invalid_input", f"Invalid {name} input contract") from None
        self.calls += 1
        invocation = Invocation(self.context, agent, read_prompt(agent))
        try:
            async with asyncio.timeout(self.context.tool_timeout_seconds):
                result = await self.handlers[name](request, invocation)
        except WorkflowError:
            raise
        except TimeoutError:
            raise WorkflowError("tool_timeout", f"{name} exceeded the tool timeout") from None
        except Exception:
            # Provider exceptions can contain resume text, signed URLs or credentials.
            raise WorkflowError(
                "tool_failed", f"{name} failed; no automatic retry was made"
            ) from None
        try:
            return spec.output_model.model_validate(
                result.model_dump() if isinstance(result, BaseModel) else result
            )
        except ValidationError:
            raise WorkflowError("invalid_output", f"Invalid {name} output contract") from None
