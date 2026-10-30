"""Version-one contracts. Credentials and owner identity never enter model input."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Version = Annotated[str, StringConstraints(pattern=r"^profile-\d+$")]
AgentId = Literal[
    "master",
    "profile",
    "fact",
    "profile-builder",
    "memory",
    "scout",
    "matcher",
    "tailor",
    "critic",
    "application-storage",
]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RunContext(Contract):
    """Construct ONLY in a trusted server after authentication, never from request JSON."""

    owner_id: Text
    request_id: Text
    max_tool_calls: int = Field(default=20, ge=1, le=100)
    tool_timeout_seconds: float = Field(default=30, gt=0, le=120)


class Source(Contract):
    id: Text
    kind: Literal["resume", "answer", "jd"]
    text: Text


class Evidence(Contract):
    source_id: Text
    quote: Text


class ProposedFact(Contract):
    id: Text
    text: Text
    evidence: tuple[Evidence, ...] = Field(min_length=1)


class ApprovedFact(ProposedFact):
    version: int = Field(ge=1)
    approval_ref: Text
    confirmation: Literal["user_confirmed", "independently_verified"] = "user_confirmed"


class Role(Contract):
    id: Text
    name: Text
    keywords: tuple[Text, ...] = ()
    fact_ids: tuple[Text, ...] = Field(min_length=1)


class ApprovedRole(Role):
    approval_ref: Text


class Preferences(Contract):
    location: str = ""
    arrangement: Literal["any", "remote", "hybrid", "onsite"] = "any"
    employment: str = ""
    seniority: str = ""
    prefer_sponsorship: bool = False


class ApprovedProfile(Contract):
    """Memory adapter must validate current owner/version/approvals in authoritative storage."""

    version: Version
    approval_ref: Text
    current: Literal[True]
    facts: tuple[ApprovedFact, ...] = Field(min_length=1)
    roles: tuple[ApprovedRole, ...] = ()
    preferences: Preferences = Field(default_factory=Preferences)

    @model_validator(mode="after")
    def references(self):
        ids = {fact.id for fact in self.facts}
        if len(ids) != len(self.facts) or len({role.id for role in self.roles}) != len(self.roles):
            raise ValueError("Duplicate profile identifiers")
        if any(not set(role.fact_ids) <= ids for role in self.roles):
            raise ValueError("Roles must reference approved facts in this snapshot")
        return self


class WorkflowRequest(Contract):
    intent: Literal["profile", "discover", "prepare_application"] = "discover"
    sources: tuple[Source, ...] = Field(default=(), max_length=30)
    saved_profile_version: Version | None = None
    selected_role_id: Text | None = None

    @model_validator(mode="after")
    def unique_sources(self):
        if len({source.id for source in self.sources}) != len(self.sources):
            raise ValueError("Duplicate source identifiers")
        if sum(source.kind == "jd" for source in self.sources) > 15:
            raise ValueError("At most 15 optional job descriptions")
        return self


class FactInput(Contract):
    sources: tuple[Source, ...] = Field(min_length=1)


class FactOutput(Contract):
    facts: tuple[ProposedFact, ...] = ()


class BuilderInput(Contract):
    facts: tuple[ApprovedFact, ...] = Field(min_length=1)
    job_descriptions: tuple[Source, ...] = ()


class BuilderOutput(Contract):
    roles: tuple[Role, ...] = ()
    questions: tuple[Text, ...] = ()


class MemoryInput(Contract):
    version: Version


class SearchInput(Contract):
    """Only this payload reaches Scout: no resume, contacts, facts or free-form goals."""

    role_name: Text
    keywords: tuple[Text, ...] = ()
    preferences: Preferences


class Job(Contract):
    id: Text
    title: Text
    company: Text
    description: Text
    application_url: Annotated[str, StringConstraints(pattern=r"^https://[^\s]+$")]


class SearchOutput(Contract):
    jobs: tuple[Job, ...] = Field(default=(), max_length=100)

    @model_validator(mode="after")
    def unique_jobs(self):
        if len({job.id for job in self.jobs}) != len(self.jobs):
            raise ValueError("Duplicate job identifiers")
        return self


class MatchInput(Contract):
    profile: ApprovedProfile
    jobs: tuple[Job, ...]


class MatchOutput(Contract):
    suitable: bool
    selected_job_id: Text | None = None
    reasons: tuple[Text, ...] = ()


class Draft(Contract):
    job_id: Text
    profile_version: Version
    content: Text


class TailorInput(Contract):
    profile: ApprovedProfile
    job: Job
    assessment: MatchOutput
    feedback: tuple[Text, ...] = ()
    previous_draft: Draft | None = None


class Check(Contract):
    passed: bool
    issues: tuple[Text, ...] = ()


class CriticInput(Contract):
    profile: ApprovedProfile
    job: Job
    draft: Draft
    draft_hash: Text


class CriticOutput(Contract):
    reviewer: Literal["critic"]
    job_id: Text
    profile_version: Version
    draft_hash: Text
    profile_facts: Check
    job_alignment: Check
    unresolved_issues: tuple[Text, ...] = ()


class StorageInput(Contract):
    job: Job
    profile_version: Version
    assessment: MatchOutput
    draft: Draft
    review: CriticOutput
    idempotency_key: Text


class StorageOutput(Contract):
    stored: bool
    job_id: Text
    profile_version: Version
    draft_hash: Text
    idempotency_key: Text
    artifact_ref: Text
