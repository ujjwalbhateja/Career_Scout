"""Load a current owner-scoped approved snapshot from authoritative Profile storage. Adapter implementation is intentionally unbound."""

from career_scout.contracts import ApprovedProfile, MemoryInput
from career_scout.tools import ToolSession, ToolSpec

SPEC = ToolSpec(
    "load_profile",
    "memory",
    MemoryInput,
    ApprovedProfile,
    "Load a current owner-scoped approved snapshot from authoritative Profile storage.",
    "read",
)


async def run(payload: MemoryInput, tools: ToolSession) -> ApprovedProfile:
    return await tools.call("memory", SPEC.name, payload)
