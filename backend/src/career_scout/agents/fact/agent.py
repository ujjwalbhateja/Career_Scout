"""Extract source-linked factual proposals from resume and answer text only. Adapter implementation is intentionally unbound."""

from career_scout.contracts import FactInput, FactOutput
from career_scout.tools import ToolSession, ToolSpec

SPEC = ToolSpec(
    "extract_facts",
    "fact",
    FactInput,
    FactOutput,
    "Extract source-linked factual proposals from resume and answer text only.",
    "none",
)


async def run(payload: FactInput, tools: ToolSession) -> FactOutput:
    return await tools.call("fact", SPEC.name, payload)
