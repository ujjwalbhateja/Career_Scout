"""Owner-scoped local run journal, completed-tool checkpoints and package storage."""

import hashlib
import io
import json
import sqlite3
import zipfile
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from career_scout.policy import WorkflowError, draft_hash, review_issues


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class RunStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS runs (
                  owner TEXT, id TEXT, request TEXT, status TEXT, phase TEXT,
                  package_date TEXT, result TEXT, updated TEXT,
                  PRIMARY KEY(owner,id));
                CREATE TABLE IF NOT EXISTS calls (
                  owner TEXT, run_id TEXT, key TEXT, result TEXT,
                  PRIMARY KEY(owner,run_id,key));
                CREATE TABLE IF NOT EXISTS packages (
                  owner TEXT, key TEXT, package TEXT, PRIMARY KEY(owner,key));
                CREATE TABLE IF NOT EXISTS scout_seen (
                  owner TEXT PRIMARY KEY, history TEXT);
                UPDATE runs SET status='interrupted'
                  WHERE status IN ('queued','running');
            """)

    @contextmanager
    def db(self):
        with sqlite3.connect(self.path, timeout=15) as db:
            db.row_factory = sqlite3.Row
            yield db

    def get(self, owner, run_id):
        with self.db() as db:
            row = db.execute(
                "SELECT * FROM runs WHERE owner=? AND id=?", (owner, run_id)
            ).fetchone()
        if not row:
            raise WorkflowError("not_found", "Run not found.")
        return {
            **dict(row),
            "request": json.loads(row["request"]),
            "result": json.loads(row["result"]) if row["result"] else None,
        }

    def list_runs(self, owner):
        with self.db() as db:
            return [
                dict(row)
                for row in db.execute(
                    "SELECT id,status,phase,updated FROM runs WHERE owner=? ORDER BY updated DESC LIMIT 25",
                    (owner,),
                )
            ]

    def create(self, owner, run_id, request, package_date):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT request FROM runs WHERE owner=? AND id=?", (owner, run_id)
            ).fetchone()
            if row:
                if row["request"] != encoded(request):
                    raise WorkflowError("conflict", "This run ID belongs to a different request.")
                return False
            if db.execute(
                "SELECT count(*) FROM runs WHERE owner=? AND status IN ('queued','running')",
                (owner,),
            ).fetchone()[0]:
                raise WorkflowError(
                    "conflict", "An application run is already active. Wait or cancel it."
                )
            db.execute(
                "INSERT INTO runs VALUES (?,?,?,?,?,?,?,?)",
                (
                    owner,
                    run_id,
                    encoded(request),
                    "queued",
                    "master",
                    package_date,
                    None,
                    datetime.now(UTC).isoformat(),
                ),
            )
        return True

    def update(self, owner, run_id, status, result=None):
        with self.db() as db:
            db.execute(
                "UPDATE runs SET status=?,result=?,updated=? WHERE owner=? AND id=?",
                (
                    status,
                    encoded(result) if result is not None else None,
                    datetime.now(UTC).isoformat(),
                    owner,
                    run_id,
                ),
            )

    def scout_history(self, owner):
        with self.db() as db:
            row = db.execute("SELECT history FROM scout_seen WHERE owner=?", (owner,)).fetchone()
        return json.loads(row[0]) if row else []

    def save_scout_history(self, owner, history):
        with self.db() as db:
            db.execute(
                "INSERT OR REPLACE INTO scout_seen VALUES (?,?)", (owner, encoded(history[-1000:]))
            )

    def phase(self, owner, run_id, phase):
        with self.db() as db:
            db.execute(
                "UPDATE runs SET phase=?,updated=? WHERE owner=? AND id=?",
                (phase, datetime.now(UTC).isoformat(), owner, run_id),
            )

    @staticmethod
    def call_key(name, payload, prompt):
        return hashlib.sha256(encoded([name, payload, prompt]).encode()).hexdigest()

    def cached(self, owner, run_id, key):
        with self.db() as db:
            row = db.execute(
                "SELECT result FROM calls WHERE owner=? AND run_id=? AND key=?",
                (owner, run_id, key),
            ).fetchone()
        return json.loads(row[0]) if row else None

    def cache(self, owner, run_id, key, result):
        with self.db() as db:
            db.execute(
                "INSERT OR REPLACE INTO calls VALUES (?,?,?,?)",
                (owner, run_id, key, encoded(result)),
            )

    def save_package(self, owner, run_id, payload):
        if (payload.job.id, payload.profile_version) != (
            payload.draft.job_id,
            payload.draft.profile_version,
        ):
            raise WorkflowError("invalid_package", "The draft does not match this job and profile.")
        if review_issues(payload.review, payload.draft):
            raise WorkflowError("review_failed", "Unresolved review prevents storage.")
        digest = draft_hash(payload.draft)
        if payload.idempotency_key != f"{run_id}:{digest}":
            raise WorkflowError("invalid_package", "Package idempotency key does not match.")
        run = self.get(owner, run_id)
        package = {**payload.model_dump(), "date": run["package_date"], "status": "ready_to_apply"}
        receipt = dict(
            stored=True,
            job_id=payload.job.id,
            profile_version=payload.profile_version,
            draft_hash=digest,
            idempotency_key=payload.idempotency_key,
            artifact_ref=run_id,
        )
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT package FROM packages WHERE owner=? AND key=?",
                (owner, payload.idempotency_key),
            ).fetchone()
            if row and row[0] != encoded(package):
                raise WorkflowError("conflict", "A different package already uses this key.")
            db.execute(
                "INSERT OR IGNORE INTO packages VALUES (?,?,?)",
                (owner, payload.idempotency_key, encoded(package)),
            )
        return receipt

    def archive(self, owner, run_id):
        run = self.get(owner, run_id)
        key = (run["result"] or {}).get("receipt", {}).get("idempotency_key")
        with self.db() as db:
            row = db.execute(
                "SELECT package FROM packages WHERE owner=? AND key=?", (owner, key)
            ).fetchone()
        if not row or run["result"].get("status") != "ready_to_apply":
            raise WorkflowError("not_found", "A validated stored package is not available.")
        package = json.loads(row[0])
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            outputs = {
                "job.json": encoded(package["job"]),
                "job-description.md": package["job"]["description"],
                "application-link.txt": package["job"]["application_url"],
                "match-assessment.json": encoded(package["assessment"]),
                "tailored-resume.md": package["draft"]["content"],
                "tailored-resume.txt": package["draft"]["content"],
                "validation.json": encoded(package["review"]),
                "manifest.json": encoded(
                    {
                        **{
                            k: package[k]
                            for k in ("date", "status", "profile_version", "idempotency_key")
                        },
                        "job_id": package["job"]["id"],
                        "draft_hash": package["review"]["draft_hash"],
                        "outputs": [
                            "job.json",
                            "job-description.md",
                            "application-link.txt",
                            "match-assessment.json",
                            "tailored-resume.md",
                            "tailored-resume.txt",
                            "validation.json",
                            "manifest.json",
                        ],
                    }
                ),
            }
            for name, content in outputs.items():
                archive.writestr(package["date"] + "/" + name, content)
        return buffer.getvalue()

    def delete(self, owner, run_id):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT status FROM runs WHERE owner=? AND id=?", (owner, run_id)
            ).fetchone()
            if not row:
                raise WorkflowError("not_found", "Run not found.")
            if row[0] in ("queued", "running"):
                raise WorkflowError("conflict", "Cancel the active run before deleting it.")
            db.execute("DELETE FROM packages WHERE owner=? AND key LIKE ?", (owner, run_id + ":%"))
            db.execute("DELETE FROM calls WHERE owner=? AND run_id=?", (owner, run_id))
            db.execute("DELETE FROM runs WHERE owner=? AND id=?", (owner, run_id))
