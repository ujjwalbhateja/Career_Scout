import pytest
from pydantic import ValidationError

from career_scout.contracts import ApprovedProfile, ResumeSourceFact, WorkflowRequest


def packet():
    return {
        "version": "current-" + "a" * 64,
        "source_ref": "a" * 64,
        "current": True,
        "facts": [
            {"id": "resume", "version": 1, "text": "Used Excel", "confirmation": "source_stated",
             "source_kind": "resume", "evidence": [{"source_id": "cv", "quote": "Used Excel"}]},
            {"id": "builder", "version": 1, "text": "Used SQL", "approval_ref": "user-approval",
             "confirmation": "user_confirmed", "evidence": [{"source_id": "answer", "quote": "Used SQL"}]},
        ],
        "search_profile": {"approvedFactIds": ["builder"], "resumeFactIds": ["resume"],
                           "skills": [{"term": "Excel", "factIds": ["resume"]},
                                      {"term": "SQL", "factIds": ["builder"]}]},
    }


def test_current_profile_preserves_source_and_approval_distinction():
    profile = ApprovedProfile.model_validate(packet())
    assert isinstance(profile.facts[0], ResumeSourceFact)
    assert not hasattr(profile.facts[0], "approval_ref")
    assert profile.facts[1].approval_ref == "user-approval"
    assert WorkflowRequest(intent="discover", saved_profile_version=profile.version)


@pytest.mark.parametrize("change", ["version", "promote", "foreign", "ungrounded", "legacy"])
def test_current_profile_rejects_mismatched_versions_and_fabricated_approvals(change):
    value = packet()
    if change == "version":
        value["source_ref"] = "b" * 64
    elif change == "promote":
        value["search_profile"]["approvedFactIds"].append("resume")
    elif change == "foreign":
        value["search_profile"]["resumeFactIds"].append("foreign")
    elif change == "ungrounded":
        value["search_profile"]["skills"][0]["term"] = "Invented tool"
    else:
        value["version"] = "profile-1"
        value["approval_ref"] = "snapshot"
    with pytest.raises(ValidationError):
        ApprovedProfile.model_validate(value)
