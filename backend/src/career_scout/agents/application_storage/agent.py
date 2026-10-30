"""Persist a validated application package idempotently and return a matching durable receipt. Adapter implementation is intentionally unbound."""

from career_scout.contracts import StorageInput, StorageOutput
from career_scout.tools import ToolSession, ToolSpec

SPEC = ToolSpec(
    "save_package",
    "application-storage",
    StorageInput,
    StorageOutput,
    "Persist a validated application package idempotently and return a matching durable receipt.",
    "write",
)


async def run(payload: StorageInput, tools: ToolSession) -> StorageOutput:
    return await tools.call("application-storage", SPEC.name, payload)
