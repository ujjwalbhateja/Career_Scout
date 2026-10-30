"""Deterministic boundaries cannot be weakened by editing prompt.md."""

import hashlib
import json

from career_scout.contracts import CriticOutput, Draft

TOP_LEVEL = ("profile", "scout", "matcher", "tailor", "critic")
PROFILE_CHILDREN = ("fact", "profile-builder", "memory")
ROUTES = {
    ("user", "master"),
    *(("master", child) for child in TOP_LEVEL),
    *((child, "master") for child in TOP_LEVEL),
    *(("profile", child) for child in PROFILE_CHILDREN),
    *((child, "profile") for child in PROFILE_CHILDREN),
    ("master", "application-storage"),
}


class WorkflowError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def route(source: str, target: str) -> dict[str, str]:
    if (source, target) not in ROUTES:
        raise WorkflowError("route_denied", f"Communication denied: {source} -> {target}")
    return {"from": source, "to": target}


def draft_hash(draft: Draft) -> str:
    encoded = json.dumps(draft.model_dump(), sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def review_issues(review: CriticOutput, draft: Draft) -> tuple[str, ...]:
    issues = []
    if (review.job_id, review.profile_version, review.draft_hash) != (
        draft.job_id,
        draft.profile_version,
        draft_hash(draft),
    ):
        issues.append("Review must cover the current job, profile version and draft hash.")
    for check in (review.profile_facts, review.job_alignment):
        if not check.passed or check.issues:
            issues.extend(check.issues or ("Both independent Critic checks must pass.",))
    issues.extend(review.unresolved_issues)
    return tuple(issues)
