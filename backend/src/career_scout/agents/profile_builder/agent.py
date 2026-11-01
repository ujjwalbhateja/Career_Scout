"""Compare supplied JD requirements with approved facts and return material questions."""

from career_scout.contracts import BuilderInput, BuilderOutput
from career_scout.tools import ToolSession, ToolSpec

SPEC = ToolSpec(
    "build_profile",
    "profile-builder",
    BuilderInput,
    BuilderOutput,
    "Compare JD requirements with approved facts; never invent roles or qualifications.",
    "none",
)


async def run(payload: BuilderInput, tools: ToolSession) -> BuilderOutput:
    return await tools.call("profile-builder", SPEC.name, payload)
