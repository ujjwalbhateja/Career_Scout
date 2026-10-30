"""Draft a job-specific resume grounded in approved facts and bounded revision feedback. Adapter implementation is intentionally unbound."""

from career_scout.contracts import Draft, TailorInput
from career_scout.tools import ToolSession, ToolSpec

SPEC = ToolSpec(
    "tailor_resume",
    "tailor",
    TailorInput,
    Draft,
    "Draft a job-specific resume grounded in approved facts and bounded revision feedback.",
    "none",
)


async def run(payload: TailorInput, tools: ToolSession) -> Draft:
    return await tools.call("tailor", SPEC.name, payload)
