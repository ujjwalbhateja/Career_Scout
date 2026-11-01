"""Loopback-only authenticated local Python service; launched by Start-Scout.

The website resolves user identity. Browser JSON cannot supply RunContext.
Only the trusted web server holds the ephemeral service token.
"""

import asyncio
import hmac
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from pydantic import ValidationError

from career_scout.adapters import ProviderBridge, production_registry
from career_scout.agent import run
from career_scout.contracts import RunContext, WorkflowRequest
from career_scout.policy import WorkflowError
from career_scout.store import RunStore
from career_scout.tools import read_prompt


class Runtime:
    def __init__(self, store, bridge):
        self.store, self.bridge = store, bridge
        self.loop = asyncio.new_event_loop()
        self.tasks = {}
        self.lock = threading.Lock()
        threading.Thread(target=self.loop.run_forever, daemon=True).start()

    async def execute(self, owner, run_id):
        self.store.update(owner, run_id, "running")
        try:
            record = self.store.get(owner, run_id)
            async with asyncio.timeout(600):
                result = await run(
                    WorkflowRequest.model_validate(record["request"]),
                    context=RunContext(owner_id=owner, request_id=run_id, tool_timeout_seconds=115),
                    registry=production_registry(self.bridge, self.store, owner, run_id),
                )
            # Expose useful results, not raw graph state or private profile facts.
            safe = {
                key: value.model_dump() if hasattr(value, "model_dump") else value
                for key, value in result.items()
                if key
                in (
                    "status",
                    "assessment",
                    "draft",
                    "review",
                    "receipt",
                    "feedback",
                    "error",
                    "tool_calls",
                    "audit",
                    "revisions",
                )
            }
            self.store.update(
                owner,
                run_id,
                "failed" if result["status"] in ("failed", "needs_configuration") else "complete",
                safe,
            )
        except asyncio.CancelledError:
            self.store.update(owner, run_id, "cancelled")
            raise
        except Exception:
            self.store.update(
                owner,
                run_id,
                "failed",
                {
                    "status": "failed",
                    "error": {
                        "code": "run_failed",
                        "message": "Application run stopped. Retry to reuse completed steps, or check provider connections.",
                    },
                },
            )
        finally:
            with self.lock:
                self.tasks.pop((owner, run_id), None)

    def start(self, owner, run_id):
        with self.lock:
            if (owner, run_id) in self.tasks:
                return
            if len(self.tasks) >= 2 or any(key[0] == owner for key in self.tasks):
                raise WorkflowError("conflict", "An application run is active. Wait or cancel it.")
            self.tasks[owner, run_id] = asyncio.run_coroutine_threadsafe(
                self.execute(owner, run_id), self.loop
            )

    def cancel(self, owner, run_id):
        with self.lock:
            task = self.tasks.get((owner, run_id))
            if task and not task.done():
                task.cancel()
                self.store.update(owner, run_id, "cancelled")


def create_server(runtime, token, port=8765):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log request URLs, bodies, tokens or profile content.

        def respond(self, data, status=200, mime="application/json"):
            body = data if isinstance(data, bytes) else json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Cache-Control", "private, no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            runtime = self.server.runtime
            if self.headers.get("Origin") or not hmac.compare_digest(
                self.headers.get("Authorization", ""), "Bearer " + token
            ):
                self.respond({"error": "Unauthorized service request."}, 401)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 400_000:
                    raise WorkflowError("invalid_request", "Request exceeds the size limit.")
                message = json.loads(self.rfile.read(length))
                if self.path == "/health":
                    self.respond(
                        {"ready": True, "runtime": "python-langgraph", "storage": "local-sqlite"}
                    )
                    return
                if self.path == "/prompt":
                    # Fixed policy file, available only to the token-authenticated
                    # web server. No caller-controlled filesystem path is read.
                    agent = message.get("agent", "profile-builder")
                    if agent not in ("profile-builder", "fact", "scout"):
                        raise WorkflowError("invalid_request", "Unknown agent policy.")
                    self.respond({"agent": agent, "prompt": read_prompt(agent)})
                    return
                owner, run_id = message.get("owner"), message.get("request_id", "")
                if not isinstance(owner, str) or not 1 <= len(owner) <= 300:
                    raise WorkflowError("invalid_request", "Trusted owner context is required.")
                if self.path == "/list":
                    self.respond({"runs": runtime.store.list_runs(owner)})
                    return
                if not isinstance(run_id, str) or not re.fullmatch(r"[a-f0-9-]{36}", run_id):
                    raise WorkflowError("invalid_request", "A valid run ID is required.")
                if self.path == "/start":
                    request = WorkflowRequest.model_validate(message["request"])
                    if request.intent != "prepare_application" or not request.saved_profile_version:
                        raise WorkflowError(
                            "invalid_request", "Activate an approved profile first."
                        )
                    date = message.get("package_date", "")
                    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
                        raise WorkflowError("invalid_request", "A package date is required.")
                    created = runtime.store.create(owner, run_id, request.model_dump(), date)
                    if created:
                        try:
                            runtime.start(owner, run_id)
                        except WorkflowError:
                            runtime.store.update(owner, run_id, "interrupted")
                            raise
                elif self.path == "/retry":
                    current = runtime.store.get(owner, run_id)
                    if current["status"] not in ("interrupted", "failed", "cancelled"):
                        raise WorkflowError(
                            "conflict", "Only interrupted, failed or cancelled runs can resume."
                        )
                    runtime.start(owner, run_id)
                elif self.path == "/cancel":
                    runtime.store.get(owner, run_id)
                    runtime.cancel(owner, run_id)
                elif self.path == "/download":
                    self.respond(runtime.store.archive(owner, run_id), mime="application/zip")
                    return
                elif self.path == "/delete":
                    runtime.store.delete(owner, run_id)
                    self.respond({"id": run_id, "status": "deleted"})
                    return
                elif self.path != "/get":
                    raise WorkflowError("not_found", "Endpoint not found.")
                record = runtime.store.get(owner, run_id)
                self.respond(
                    {key: record[key] for key in ("id", "status", "phase", "result", "updated")}
                )
            except WorkflowError as error:
                self.respond(
                    {"error": str(error)},
                    404 if error.code == "not_found" else 409 if error.code == "conflict" else 400,
                )
            except (ValueError, KeyError, ValidationError, TypeError):
                self.respond(
                    {
                        "error": "Invalid pipeline request. Check the approved profile and job details."
                    },
                    400,
                )
            except Exception:
                self.respond({"error": "Pipeline service could not complete this operation."}, 500)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.runtime = runtime
    return server


def main():
    root = Path(__file__).resolve().parents[3]
    token = os.environ.get("CAREER_AGENT_TOKEN", "")
    if len(token) < 32:
        raise SystemExit(
            "Start this service through Start-Scout.cmd to supply a private service token."
        )
    store_path = Path(
        os.environ.get("CAREER_AGENT_STORE", str(root / ".local" / "pipeline" / "runs.sqlite3"))
    ).resolve()
    if not store_path.is_relative_to((root / ".local").resolve()):
        raise SystemExit(
            "The pipeline journal must stay inside the private local workspace directory."
        )
    # Bind first. A second launcher must not mark an active service's runs as
    # interrupted before discovering that the port is already occupied.
    server = create_server(None, token, int(os.environ.get("CAREER_AGENT_PORT", "8765")))
    store = RunStore(store_path)
    bridge = ProviderBridge(root, os.environ.get("CAREER_NODE", "node"))
    server.runtime = Runtime(store, bridge)
    print("Career Scout Python pipeline listening on 127.0.0.1", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
