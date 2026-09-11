"""Opt-in Phase 0 editor transport. In-memory only; never writes activity/media."""
from __future__ import annotations

import copy
import json
import re
import secrets
import threading
import time
from pathlib import Path


class SpikeError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def bin_name(value):
    if not isinstance(value, str):
        raise SpikeError("bin_name must be text")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")[:100]
    if not name:
        raise SpikeError("A bin name is required")
    return name


def checked_path(root, value):
    """Resolve junctions/symlinks and reject sibling prefixes, traversal and ADS."""
    if not isinstance(value, str) or not value:
        raise SpikeError("Catalog clip has no source path")
    candidate = Path(value)
    if any(":" in part for part in candidate.parts[(1 if candidate.anchor else 0):]):
        raise SpikeError("Alternate data streams are not source clips")
    root = Path(root).resolve(strict=True)
    candidate = (candidate if candidate.is_absolute() else root / candidate).resolve()
    if not candidate.is_relative_to(root) or candidate == root:
        raise SpikeError("Source path is outside the configured B-roll root")
    return str(candidate), candidate.is_file()


class EditorSpike:
    HEARTBEAT_TTL = 15
    JOB_TTL = 300

    def __init__(self, root, lookup, clock=time.monotonic):
        self.root, self.lookup, self.clock = Path(root), lookup, clock
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.peers, self.jobs = {}, {}

    def dispatch(self, action, body):
        if not isinstance(body, dict):
            raise SpikeError("Expected a JSON object")
        with self.lock:
            now = self.clock()
            for job in self.jobs.values():
                if now > job["expires_at"] and job["state"] in ("queued", "claimed"):
                    job["state"] = "expired"  # never automatically re-import uncertain work
            if action == "status":
                peers = {k: {**v, "connected": now - v["seen"] < self.HEARTBEAT_TTL}
                         for k, v in self.peers.items()}
                return copy.deepcopy({"ok": True, "editors": peers, "jobs": list(self.jobs.values())})
            editor = body.get("editor")
            if editor not in ("premiere", "resolve"):
                raise SpikeError("editor must be premiere or resolve")
            if action == "heartbeat":
                for key in ("client_id", "version", "project_id", "project_name"):
                    if not isinstance(body.get(key), str) or len(body[key]) > 512:
                        raise SpikeError(f"Invalid {key}")
                if not body["client_id"]:
                    raise SpikeError("client_id is required")
                self.peers[editor] = {k: body[k] for k in
                                      ("client_id", "version", "project_id", "project_name")}
                self.peers[editor]["seen"] = now
                return {"ok": True}
            if action == "jobs":
                ids = body.get("clip_ids")
                if not isinstance(ids, list) or not 1 <= len(ids) <= 5 or any(
                        type(i) is not int or i <= 0 for i in ids) or len(set(ids)) != len(ids):
                    raise SpikeError("Phase 0 requires 1–5 distinct positive catalog clip IDs")
                peer = self.peers.get(editor)
                if not peer or now - peer["seen"] >= self.HEARTBEAT_TTL:
                    raise SpikeError("Open the editor and connect the spike adapter", 409)
                if not peer["project_id"]:
                    raise SpikeError("Open an editor project first", 409)
                if body.get("project_id") != peer["project_id"]:
                    raise SpikeError("Active project changed; review status and send again", 409)
                name = bin_name(body.get("bin_name"))
                rows = {r["id"]: r for r in self.lookup(ids)}
                items = []
                for clip_id in ids:
                    if clip_id not in rows:
                        raise SpikeError(f"Unknown catalog clip ID: {clip_id}")
                    row = rows[clip_id]
                    path, present = checked_path(self.root, row.get("absolute_path") or row.get("relative_path"))
                    items.append({"clip_id": clip_id, "path": path,
                                  "status": "pending" if present else "missing"})
                # Bound memory. Retain unresolved transfers until they expire.
                if len(self.jobs) >= 100:
                    old = next((k for k, j in self.jobs.items() if j["state"] in ("completed", "expired")), None)
                    if old is None:
                        raise SpikeError("Spike queue is full", 409)
                    del self.jobs[old]
                job = {"id": secrets.token_hex(16), "editor": editor, "bin_name": name,
                       "project_id": peer["project_id"], "project_name": peer["project_name"],
                       "state": "queued", "items": items, "expires_at": now + self.JOB_TTL}
                self.jobs[job["id"]] = job
                return {"ok": True, "job": copy.deepcopy(job)}
            if action == "claim":
                peer = self.peers.get(editor)
                if (not peer or now - peer["seen"] >= self.HEARTBEAT_TTL or
                        body.get("client_id") != peer["client_id"] or
                        body.get("project_id") != peer["project_id"] or not peer["project_id"]):
                    raise SpikeError("Refresh heartbeat with an active project before claiming", 409)
                if any(j["editor"] == editor and j["state"] == "claimed" for j in self.jobs.values()):
                    return {"ok": True, "job": None}
                for job in self.jobs.values():
                    if job["editor"] == editor and job["state"] == "queued" and job["project_id"] == peer["project_id"]:
                        job.update(state="claimed", client_id=peer["client_id"], claim_id=secrets.token_hex(16))
                        return {"ok": True, "job": copy.deepcopy(job)}
                return {"ok": True, "job": None}
            if action == "result":
                if not isinstance(body.get("job_id"), str):
                    raise SpikeError("job_id must be text")
                job = self.jobs.get(body.get("job_id"))
                if not job or job["editor"] != editor:
                    raise SpikeError("Unknown job", 404)
                if any(body.get(k) != job.get(k) for k in ("claim_id", "client_id", "project_id")):
                    raise SpikeError("Result does not match the claimed project/job", 409)
                results = body.get("items")
                if not isinstance(results, list) or len(results) != len(job["items"]):
                    raise SpikeError("Return exactly one result per requested clip")
                expected = {i["clip_id"]: i for i in job["items"]}
                seen = set()
                for item in results:
                    if not isinstance(item, dict) or type(item.get("clip_id")) is not int:
                        raise SpikeError("Invalid result item")
                    clip_id = item["clip_id"]
                    if clip_id not in expected or clip_id in seen or item.get("status") not in ("imported", "existing", "missing", "failed"):
                        raise SpikeError("Invalid or duplicate clip result")
                    if expected[clip_id]["status"] == "missing" and item["status"] != "missing":
                        raise SpikeError("A rejected missing source cannot be reported as imported")
                    seen.add(clip_id)
                clean = [{"clip_id": i["clip_id"], "status": i["status"],
                          "message": str(i.get("message", ""))[:1000]} for i in results]
                if job["state"] == "completed" and job["results"] == clean:
                    return {"ok": True, "job": copy.deepcopy(job)}
                if job["state"] != "claimed":
                    raise SpikeError("Job is no longer awaiting results; inspect the editor before retrying", 409)
                job.update(state="completed", results=clean)
                return {"ok": True, "job": copy.deepcopy(job)}
            raise SpikeError("Unknown spike action", 404)

    def handle(self, handler, action):
        """Own HTTP parsing: no wildcard CORS, bounded body, token before catalog access."""
        status = 200
        try:
            expected_host = f"127.0.0.1:{handler.server.server_port}"
            if handler.headers.get("Host") != expected_host or handler.headers.get("Origin"):
                raise SpikeError("Spike is restricted to native loopback clients", 403)
            supplied = handler.headers.get("Authorization", "")
            if not secrets.compare_digest(supplied, "Bearer " + self.token):
                raise SpikeError("Invalid runtime token", 401)
            try:
                length = int(handler.headers.get("Content-Length", "0"))
            except ValueError:
                raise SpikeError("Invalid body length")
            if not 0 < length <= 65536:
                raise SpikeError("Expected a JSON body smaller than 64 KiB")
            handler.connection.settimeout(10)
            try:
                body = json.loads(handler.rfile.read(length))
            except (ValueError, UnicodeError):
                raise SpikeError("Malformed JSON")
            payload = self.dispatch(action, body)
        except SpikeError as exc:
            status, payload = exc.status, {"ok": False, "error": str(exc)}
        except (OSError, RuntimeError) as exc:
            status, payload = 503, {"ok": False, "error": str(exc)}
        data = json.dumps(payload).encode("utf-8")
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(data)))
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("Connection", "close")
        handler.end_headers()
        handler.wfile.write(data)
        handler.close_connection = True
