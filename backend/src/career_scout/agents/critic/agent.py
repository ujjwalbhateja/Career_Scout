"""Independently review profile grounding and job alignment for the exact draft hash. Adapter implementation is intentionally unbound."""

from career_scout.contracts import CriticInput, CriticOutput
from career_scout.tools import ToolSession, ToolSpec

SPEC = ToolSpec(
    "review_draft",
    "critic",
    CriticInput,
    CriticOutput,
    "Independently review profile grounding and job alignment for the exact draft hash.",
    "none",
)


async def run(payload: CriticInput, tools: ToolSession) -> CriticOutput:
    return await tools.call("critic", SPEC.name, payload)
