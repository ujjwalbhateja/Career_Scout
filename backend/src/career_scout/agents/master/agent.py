"""Production entry composition: explicit routing, isolated state, bounded revisions."""

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from career_scout.agents.application_storage import agent as storage
from career_scout.agents.critic import agent as critic
from career_scout.agents.matcher import agent as matcher
from career_scout.agents.profile import agent as profile
from career_scout.agents.scout import agent as scout
from career_scout.agents.tailor import agent as tailor
from career_scout.contracts import (
    CriticInput,
    MatchInput,
    SearchInput,
    StorageInput,
    TailorInput,
    WorkflowRequest,
)
from career_scout.policy import WorkflowError, draft_hash, review_issues, route
from career_scout.tools import ToolSession, read_prompt


class WorkflowState(TypedDict, total=False):
    request: WorkflowRequest
    phase: str
    next: str
    status: str
    data: Any
    profile: Any
    jobs: Any
    assessment: Any
    job: Any
    draft: Any
    review: Any
    receipt: Any
    feedback: tuple[str, ...]
    revisions: int
    error: dict[str, str]
    audit: list[dict[str, str]]


def build_graph(tools: ToolSession, *, max_revisions: int = 2):
    if (
        isinstance(max_revisions, bool)
        or not isinstance(max_revisions, int)
        or not 0 <= max_revisions <= 5
    ):
        raise ValueError("max_revisions must be an integer from zero to five")
    read_prompt("master")

    def finish(status, **updates):
        return {"next": "end", "status": status, **updates}

    def coordinator(state):
        if state.get("error"):
            code = state["error"]["code"]
            return finish("needs_configuration" if code == "not_implemented" else "failed")
        phase = state.get("phase")
        if not phase:
            child = "profile"
        elif phase == "profile":
            if state["status"] != "profile_ready" or state["request"].intent == "profile":
                return finish(state["status"])
            if state["request"].selected_job is not None:
                profile_selected = (
                    state["profile"].search_profile is not None
                    and state["request"].selected_role_id in (None, "master-profile")
                )
                if not profile_selected:
                    return finish(
                        "needs_review",
                        error={
                            "code": "role_selection_required",
                            "message": "Select the saved master profile for this application.",
                        },
                    )
                return {
                    "next": "matcher",
                    "jobs": (state["request"].selected_job,),
                    "audit": [*state["audit"], route("master", "matcher")],
                }
            child = "scout"
        elif phase == "scout":
            if not state["jobs"]:
                return finish("no_jobs")
            if state["request"].intent == "discover":
                return finish("jobs_found")
            child = "matcher"
        elif phase == "matcher":
            if not state["assessment"].suitable:
                return finish("needs_review")
            child = "tailor"
        elif phase == "tailor":
            child = "critic"
        elif phase == "critic":
            feedback = review_issues(state["review"], state["draft"])
            if feedback:
                if state["revisions"] >= max_revisions:
                    return finish("needs_review", feedback=feedback)
                return {
                    "next": "tailor",
                    "feedback": feedback,
                    "revisions": state["revisions"] + 1,
                    "audit": [*state["audit"], route("master", "tailor")],
                }
            child = "application-storage"
        elif phase == "application-storage":
            return finish("ready_to_apply")
        else:
            return finish(
                "failed", error={"code": "invalid_state", "message": "Unknown workflow phase"}
            )
        return {"next": child, "audit": [*state["audit"], route("master", child)]}

    async def get_profile(state):
        result = await profile.run(state["request"], tools)
        return {
            "status": result["status"],
            "profile": result.get("profile"),
            "data": result.get("data"),
            "audit": [*state["audit"], *result["audit"]],
        }

    async def search(state):
        approved = state["profile"]
        if state["request"].selected_role_id not in (None, "master-profile"):
            raise WorkflowError("profile_selection_required", "Select the saved master profile")
        if approved.search_profile is not None:
            context = approved.search_profile
            result = await scout.run(
                SearchInput(
                    role_name=context.roleName,
                    preferences=approved.preferences,
                    scout_context=context,
                    previous_seen=context.previousSeen,
                ),
                tools,
            )
            return {"jobs": result.jobs}
        raise WorkflowError(
            "profile_save_required", "Build and save the validated master profile first"
        )

    async def match(state):
        assessment = await matcher.run(
            MatchInput(profile=state["profile"], jobs=state["jobs"]), tools
        )
        job = next((j for j in state["jobs"] if j.id == assessment.selected_job_id), None)
        if assessment.suitable and job is None:
            raise WorkflowError("invalid_job", "Matcher selected a job outside the shortlist")
        return {"assessment": assessment, "job": job}

    async def draft(state):
        result = await tailor.run(
            TailorInput(
                profile=state["profile"],
                job=state["job"],
                assessment=state["assessment"],
                feedback=state.get("feedback", ()),
                previous_draft=state.get("draft"),
            ),
            tools,
        )
        if (result.job_id, result.profile_version) != (state["job"].id, state["profile"].version):
            raise WorkflowError("invalid_draft", "Draft job/profile identity must match")
        return {"draft": result, "review": None}

    async def review(state):
        result = await critic.run(
            CriticInput(
                profile=state["profile"],
                job=state["job"],
                draft=state["draft"],
                draft_hash=draft_hash(state["draft"]),
            ),
            tools,
        )
        return {"review": result}

    async def save(state):
        # Go through Profile again: Memory is authoritative and never cached.
        # Revoked facts or a newly active snapshot invalidate this draft.
        current = await profile.run(state["request"], tools)
        exclude_history = {
            "roles": {"__all__": {"scout_context": {"previousSeen"}}},
            "search_profile": {"previousSeen"},
        }
        if current.get("profile") is None or current["profile"].model_dump(
            exclude=exclude_history
        ) != state["profile"].model_dump(exclude=exclude_history):
            raise WorkflowError("stale_profile", "Your approved profile changed. Start again.")
        # Recheck at the write boundary even though Master already checked the review.
        if review_issues(state["review"], state["draft"]):
            raise WorkflowError("review_failed", "Unresolved Critic review prevents storage")
        digest = draft_hash(state["draft"])
        key = f"{tools.context.request_id}:{digest}"
        receipt = await storage.run(
            StorageInput(
                job=state["job"],
                profile_version=state["profile"].version,
                assessment=state["assessment"],
                draft=state["draft"],
                review=state["review"],
                idempotency_key=key,
            ),
            tools,
        )
        if not receipt.stored or (
            receipt.job_id,
            receipt.profile_version,
            receipt.draft_hash,
            receipt.idempotency_key,
        ) != (state["job"].id, state["profile"].version, digest, key):
            raise WorkflowError("invalid_receipt", "Storage did not confirm this validated package")
        return {
            "receipt": receipt,
            "audit": [
                *state["audit"],
                route("master", "profile"),
                *current["audit"],
                route("profile", "master"),
            ],
        }

    def guarded(name, function):
        async def node(state):
            try:
                updates = await function(state)
                audit = updates.get("audit", state["audit"])
                # Storage is a tool of Master; its receipt is not a peer-agent route.
                if name != "application-storage":
                    audit = [*audit, route(name, "master")]
                return {**updates, "audit": audit, "phase": name}
            except WorkflowError as exc:
                return {"error": {"code": exc.code, "message": str(exc)}}

        return node

    graph = StateGraph(WorkflowState)
    graph.add_node("master", coordinator)
    nodes = {
        "profile": get_profile,
        "scout": search,
        "matcher": match,
        "tailor": draft,
        "critic": review,
        "application-storage": save,
    }
    for name, function in nodes.items():
        graph.add_node(name, guarded(name, function))
        graph.add_edge(name, "master")
    graph.add_edge(START, "master")
    graph.add_conditional_edges(
        "master", lambda state: state["next"], {**{name: name for name in nodes}, "end": END}
    )
    return graph.compile()
