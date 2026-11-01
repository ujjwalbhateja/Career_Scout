"""Profile is the sole coordinator of Fact, Builder and Memory."""

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from career_scout.agents.fact import agent as fact
from career_scout.agents.memory import agent as memory
from career_scout.agents.profile_builder import agent as builder
from career_scout.contracts import BuilderInput, FactInput, MemoryInput, WorkflowRequest
from career_scout.policy import WorkflowError, route
from career_scout.tools import ToolSession, read_prompt


class ProfileState(TypedDict, total=False):
    request: WorkflowRequest
    phase: str
    next: str
    status: str
    data: Any
    profile: Any
    audit: list[dict[str, str]]


def build_graph(tools: ToolSession):
    read_prompt("profile")

    def coordinator(state):
        phase = state.get("phase")
        if phase == "facts":
            return {"next": "end", "status": "needs_fact_approval"}
        if phase == "builder":
            return {"next": "end", "status": "needs_profile_save"}
        if phase == "memory":
            if state["profile"].search_profile is not None:
                return {"next": "end", "status": "profile_ready"}
            return {"next": "end", "status": "needs_profile_save"}
        elif state["request"].saved_profile_version:
            child = "memory"
        elif any(source.kind == "resume" for source in state["request"].sources):
            child = "fact"
        else:
            return {"next": "end", "status": "needs_resume"}
        return {"next": child, "audit": [*state["audit"], route("profile", child)]}

    async def extract(state):
        sources = tuple(source for source in state["request"].sources if source.kind != "jd")
        result = await fact.run(FactInput(sources=sources), tools)
        texts = {source.id: source.text for source in sources}
        if len({item.id for item in result.facts}) != len(result.facts):
            raise WorkflowError("invalid_evidence", "Fact IDs must be unique")
        if any(
            e.source_id not in texts or e.quote not in texts[e.source_id]
            for item in result.facts
            for e in item.evidence
        ):
            raise WorkflowError(
                "invalid_evidence", "Facts require exact supplied source quotations"
            )
        return {
            "phase": "facts",
            "data": result,
            "audit": [*state["audit"], route("fact", "profile")],
        }

    async def load(state):
        version = state["request"].saved_profile_version
        result = await memory.run(MemoryInput(version=version), tools)
        if result.version != version:
            raise WorkflowError("stale_profile", "Reload the current approved profile")
        return {
            "phase": "memory",
            "profile": result,
            "audit": [*state["audit"], route("memory", "profile")],
        }

    async def build(state):
        payload = BuilderInput(
            facts=state["profile"].facts,
            job_descriptions=tuple(s for s in state["request"].sources if s.kind == "jd"),
        )
        result = await builder.run(payload, tools)
        ids = {item.id for item in payload.facts}
        if len({role.id for role in result.roles}) != len(result.roles) or any(
            not set(role.fact_ids) <= ids for role in result.roles
        ):
            raise WorkflowError(
                "invalid_evidence", "Profile metadata requires unique IDs and approved fact refs"
            )
        return {
            "phase": "builder",
            "data": result,
            "audit": [*state["audit"], route("profile-builder", "profile")],
        }

    graph = StateGraph(ProfileState)
    graph.add_node("profile", coordinator)
    for name, node in (("fact", extract), ("memory", load), ("profile-builder", build)):
        graph.add_node(name, node)
        graph.add_edge(name, "profile")
    graph.add_edge(START, "profile")
    graph.add_conditional_edges(
        "profile",
        lambda state: state["next"],
        {
            "fact": "fact",
            "memory": "memory",
            "profile-builder": "profile-builder",
            "end": END,
        },
    )
    return graph.compile()


async def run(request: WorkflowRequest, tools: ToolSession):
    return await build_graph(tools).ainvoke({"request": request, "audit": []})
