import asyncio
import io
import json
import threading
import urllib.error
import urllib.request
import uuid
import zipfile

import pytest
from test_workflow import approved, context, fixture_registry, request

from career_scout.adapters import production_registry
from career_scout.agent import run
from career_scout.contracts import RunContext, StorageInput
from career_scout.policy import WorkflowError
from career_scout.service import Runtime, create_server
from career_scout.store import RunStore


async def test_selected_job_goes_to_matcher_without_search_and_rechecks_profile():
    registry, calls = fixture_registry()
    original = await run(
        request(intent="prepare_application"), context=context(), registry=registry
    )
    registry, calls = fixture_registry()
    selected = request(intent="prepare_application", selected_job=original["job"])
    result = await run(selected, context=context(), registry=registry)
    assert result["status"] == "ready_to_apply"
    assert [c[0] for c in calls] == [
        "memory",
        "matcher",
        "tailor",
        "critic",
        "memory",
        "application-storage",
    ]
    assert all(edge["from"] != "scout" for edge in result["audit"])


async def test_profile_changed_during_generation_prevents_storage():
    count = 0

    async def load(_payload, _invocation):
        nonlocal count
        count += 1
        if count > 1:
            raise WorkflowError("stale_profile", "Approval was revoked.")
        return approved()

    registry, calls = fixture_registry(overrides={"memory": load})
    result = await run(request(intent="prepare_application"), context=context(), registry=registry)
    assert result["status"] == "failed"
    assert not any(call[0] == "application-storage" for call in calls)


async def test_sqlite_receipt_archive_owner_isolation_and_replay(tmp_path):
    registry, calls = fixture_registry()
    completed = await run(
        request(intent="prepare_application"), context=context(), registry=registry
    )
    store = RunStore(tmp_path / "runs.sqlite3")
    run_id = "run-1"
    store.create("owner", run_id, request().model_dump(), "2026-10-30")
    storage = next(c[1] for c in calls if c[0] == "application-storage")
    receipt = store.save_package("owner", run_id, storage)
    assert store.save_package("owner", run_id, storage) == receipt
    store.update("owner", run_id, "complete", {"status": "ready_to_apply", "receipt": receipt})
    with zipfile.ZipFile(io.BytesIO(store.archive("owner", run_id))) as archive:
        assert len(archive.namelist()) == 8
        assert archive.read("2026-10-30/tailored-resume.md").decode() == completed["draft"].content
    with pytest.raises(WorkflowError, match="not found"):
        store.archive("someone-else", run_id)
    assert store.list_runs("someone-else") == []
    store.phase("owner", run_id, "critic")
    store.update("owner", run_id, "running")
    reopened = RunStore(tmp_path / "runs.sqlite3")
    assert reopened.get("owner", run_id)["status"] == "interrupted"
    with pytest.raises(WorkflowError, match="different request"):
        reopened.create("owner", run_id, {}, "2026-10-30")
    invalid = StorageInput.model_validate(storage.model_dump())
    invalid = invalid.model_copy(update={"idempotency_key": "wrong"})
    with pytest.raises(WorkflowError, match="idempotency"):
        store.save_package("owner", run_id, invalid)
    reopened.delete("owner", run_id)
    assert reopened.list_runs("owner") == []
    with pytest.raises(WorkflowError, match="not found"):
        reopened.archive("owner", run_id)


async def test_real_registry_checkpoints_models_but_reloads_memory(tmp_path):
    fixtures, _ = fixture_registry()
    calls = []

    class Bridge:
        async def call(self, name, payload, invocation):
            calls.append(name)
            return await fixtures._handlers[name](payload, invocation)

    store = RunStore(tmp_path / "journal.sqlite3")
    store.create("owner", "run-1", request().model_dump(), "2026-10-30")
    registry = production_registry(Bridge(), store, "owner", "run-1")
    for _ in range(2):
        result = await run(
            request(intent="prepare_application"),
            context=RunContext(owner_id="owner", request_id="run-1"),
            registry=registry,
        )
        assert result["status"] == "ready_to_apply"
    assert calls.count("tailor_resume") == 1
    assert calls.count("review_draft") == 1
    assert calls.count("load_profile") == 4


async def test_cancellation_stops_provider_and_marks_run_recoverable(tmp_path):
    started = threading.Event()
    stopped = threading.Event()

    class SlowBridge:
        async def call(self, *_args):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

    store = RunStore(tmp_path / "cancel.sqlite3")
    store.create("owner", "run-1", request(intent="prepare_application").model_dump(), "2026-10-30")
    runtime = Runtime(store, SlowBridge())
    try:
        runtime.start("owner", "run-1")
        assert await asyncio.to_thread(started.wait, 3)
        runtime.cancel("owner", "run-1")
        assert await asyncio.to_thread(stopped.wait, 3)
        assert store.get("owner", "run-1")["status"] == "cancelled"
        # Another owner's cancellation cannot target this run.
        runtime.cancel("other-owner", "run-1")
        assert store.get("owner", "run-1")["status"] == "cancelled"
    finally:
        runtime.loop.call_soon_threadsafe(runtime.loop.stop)


def test_http_boundary_requires_token_and_isolates_owners(tmp_path):
    class NoProvider:
        async def call(self, *_args):
            raise WorkflowError("provider_failed", "Synthetic provider unavailable.")

    runtime = Runtime(RunStore(tmp_path / "http.sqlite3"), NoProvider())
    token = "a" * 64
    server = create_server(runtime, token, 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def post(path, body, authenticated=True):
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/{path}",
            data=json.dumps(body).encode(),
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.load(response)

    try:
        with pytest.raises(urllib.error.HTTPError) as error:
            post("health", {}, False)
        assert error.value.code == 401
        assert post("health", {})["ready"]
        assert "Profile Builder" in post("prompt", {})["prompt"]
        run_id = str(uuid.uuid4())
        result = post(
            "start",
            {
                "owner": "first",
                "request_id": run_id,
                "request": request(intent="prepare_application").model_dump(),
                "package_date": "2026-10-30",
            },
        )
        assert result["id"] == run_id
        with pytest.raises(urllib.error.HTTPError) as error:
            post("get", {"owner": "second", "request_id": run_id})
        assert error.value.code == 404
        assert post("list", {"owner": "second"}) == {"runs": []}
    finally:
        server.shutdown()
        server.server_close()
        runtime.loop.call_soon_threadsafe(runtime.loop.stop)
