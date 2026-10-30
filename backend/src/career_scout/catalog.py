"""Add future tools explicitly here; each declares an owner and typed IO."""

from career_scout.agents.application_storage.agent import SPEC as STORAGE
from career_scout.agents.critic.agent import SPEC as CRITIC
from career_scout.agents.fact.agent import SPEC as FACT
from career_scout.agents.matcher.agent import SPEC as MATCHER
from career_scout.agents.memory.agent import SPEC as MEMORY
from career_scout.agents.profile_builder.agent import SPEC as BUILDER
from career_scout.agents.scout.agent import SPEC as SCOUT
from career_scout.agents.tailor.agent import SPEC as TAILOR
from career_scout.tools import ToolRegistry

TOOL_SPECS = (FACT, BUILDER, MEMORY, SCOUT, MATCHER, TAILOR, CRITIC, STORAGE)


def create_registry() -> ToolRegistry:
    """Safe default: no network, storage, model calls or sample data bindings."""
    return ToolRegistry(TOOL_SPECS)
