"""Assess supplied jobs against approved profile facts and select a supplied job ID. Adapter implementation is intentionally unbound."""

from career_scout.contracts import MatchInput, MatchOutput
from career_scout.tools import ToolSession, ToolSpec

SPEC = ToolSpec(
    "match_jobs",
    "matcher",
    MatchInput,
    MatchOutput,
    "Assess supplied jobs against approved profile facts and select a supplied job ID.",
    "none",
)


async def run(payload: MatchInput, tools: ToolSession) -> MatchOutput:
    return await tools.call("matcher", SPEC.name, payload)
