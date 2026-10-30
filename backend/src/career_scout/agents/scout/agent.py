"""Discover jobs using the selected role, approved keywords and allowlisted preferences. Adapter implementation is intentionally unbound."""

from career_scout.contracts import SearchInput, SearchOutput
from career_scout.tools import ToolSession, ToolSpec

SPEC = ToolSpec(
    "search_jobs",
    "scout",
    SearchInput,
    SearchOutput,
    "Discover jobs using the selected role, approved keywords and allowlisted preferences.",
    "external_request",
)


async def run(payload: SearchInput, tools: ToolSession) -> SearchOutput:
    return await tools.call("scout", SPEC.name, payload)
