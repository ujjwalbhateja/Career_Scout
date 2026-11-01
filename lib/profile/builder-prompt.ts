// Server import: Vite bundles the same editable prompt used by the Python agent.
// Never read a caller-supplied path or accept prompt instructions from API JSON.
import prompt from '../../backend/src/career_scout/agents/profile_builder/prompt.md?raw';
export const PROFILE_BUILDER_PROMPT=prompt;
