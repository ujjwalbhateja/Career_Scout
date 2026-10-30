"""Propose supported roles, keywords and follow-up questions from approved facts; JDs are optional. Adapter implementation is intentionally unbound."""

from career_scout.contracts import BuilderInput, BuilderOutput
from career_scout.tools import ToolSession, ToolSpec

SPEC = ToolSpec(
    "build_profile",
    "profile-builder",
    BuilderInput,
    BuilderOutput,
    "Propose supported roles, keywords and follow-up questions from approved facts; JDs are optional.",
    "none",
)


async def run(payload: BuilderInput, tools: ToolSession) -> BuilderOutput:
    return await tools.call("profile-builder", SPEC.name, payload)
