import concurrent.futures
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from editor_spike import EditorSpike, SpikeError, checked_path
from server_api import CatalogHandler


class SpikeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "library"
        self.root.mkdir()
        (self.root / "clip.mov").write_bytes(b"untouched fixture")
        self.now = 0
        self.spike = EditorSpike(self.root, lambda ids: [
            {"id": i, "relative_path": "clip.mov" if i == 1 else "missing.mov"} for i in ids if i != 99
        ], clock=lambda: self.now)
        self.peer = dict(editor="premiere", client_id="panel1", version="26.3", project_id="project1", project_name="Test")
        self.spike.dispatch("heartbeat", self.peer)

    def queue(self, ids=None):
        return self.spike.dispatch("jobs", dict(editor="premiere", project_id="project1", bin_name="Test / bin",
                                                clip_ids=ids or [1, 2]))["job"]

    def claim(self):
        return self.spike.dispatch("claim", self.peer)["job"]

    def receipt(self, job):
        return dict(editor="premiere", client_id="panel1", project_id="project1", claim_id=job["claim_id"],
                    job_id=job["id"], items=[{"clip_id": 1, "status": "imported"}, {"clip_id": 2, "status": "missing"}])

    def test_partial_import_and_idempotent_receipt(self):
        queued = self.queue()
        self.assertEqual(queued["bin_name"], "Test _ bin")
        job = self.claim()
        self.assertIsNone(self.claim())
        result = self.spike.dispatch("result", self.receipt(job))
        self.assertEqual(result["job"]["state"], "completed")
        self.assertEqual(result, self.spike.dispatch("result", self.receipt(job)))
        self.assertEqual((self.root / "clip.mov").read_bytes(), b"untouched fixture")
        self.assertEqual(list(self.root.iterdir()), [self.root / "clip.mov"])

    def test_expired_claim_cannot_claim_or_report_success(self):
        self.queue()
        job = self.claim()
        self.now = 301
        with self.assertRaises(SpikeError):
            self.spike.dispatch("result", self.receipt(job))
        self.spike.dispatch("heartbeat", self.peer)
        self.assertIsNone(self.claim())

    def test_project_switch_and_stale_heartbeat(self):
        self.queue()
        changed = {**self.peer, "project_id": "project2"}
        self.spike.dispatch("heartbeat", changed)
        self.assertIsNone(self.spike.dispatch("claim", changed)["job"])
        with self.assertRaises(SpikeError):
            self.queue()
        self.now = 16
        with self.assertRaises(SpikeError):
            self.spike.dispatch("claim", changed)

    def test_closed_editor_and_no_project(self):
        self.spike.peers.clear()
        with self.assertRaises(SpikeError):
            self.queue()
        self.spike.dispatch("heartbeat", {**self.peer, "project_id": "", "project_name": ""})
        with self.assertRaises(SpikeError):
            self.queue()

    def test_single_claim_under_concurrency(self):
        self.queue()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            jobs = list(pool.map(lambda _: self.claim(), range(8)))
        self.assertEqual(sum(j is not None for j in jobs), 1)

    def test_second_panel_cannot_import_concurrently(self):
        self.queue()
        self.queue()
        self.claim()
        second = {**self.peer, "client_id": "panel2"}
        self.spike.dispatch("heartbeat", second)
        self.assertIsNone(self.spike.dispatch("claim", second)["job"])

    def test_bad_ids(self):
        for ids in ([99], [True], [1, 1], [1, 2, 3, 4, 5, 6]):
            with self.subTest(ids=ids), self.assertRaises(SpikeError):
                self.queue(ids)

    def test_result_cannot_invent_or_duplicate_success(self):
        self.queue()
        job = self.claim()
        for update in ({"items": [{"clip_id": 1, "status": "imported"}]},
                       {"items": [{"clip_id": 1, "status": "imported"}] * 2},
                       {"items": [{"clip_id": 1, "status": "imported"}, {"clip_id": 2, "status": "imported"}]},
                       {"claim_id": "wrong"}, {"project_id": "different"}):
            with self.subTest(update=update), self.assertRaises(SpikeError):
                self.spike.dispatch("result", {**self.receipt(job), **update})

    def test_traversal_sibling_prefix_and_ads(self):
        for path in ("../outside.mov", str(self.root) + "-other/clip.mov", "clip.mov:stream"):
            with self.subTest(path=path), self.assertRaises(SpikeError):
                checked_path(self.root, path)

    def test_http_auth_origin_host_and_body_limits(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), CatalogHandler)
        server.editor_spike = self.spike
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(headers=None, body="{}"):
            conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            conn.request("POST", "/api/spike/status", body,
                         headers or {"Authorization": "Bearer " + self.spike.token})
            response = conn.getresponse()
            status, cors = response.status, response.getheader("Access-Control-Allow-Origin")
            payload = json.loads(response.read())
            conn.close()
            return status, cors, payload
        self.assertEqual(request()[0], 200)
        for headers in ({"Authorization": "wrong"},
                        {"Authorization": "Bearer " + self.spike.token, "Origin": "https://untrusted.example"},
                        {"Authorization": "Bearer " + self.spike.token, "Host": "untrusted.example"}):
            result = request(headers)
            self.assertIn(result[0], (401, 403))
            self.assertIsNone(result[1])
        self.assertEqual(request(body="[]")[0], 400)
        self.assertEqual(request(body="{" )[0], 400)
        self.assertEqual(request(body="x" * 65537)[0], 400)


if __name__ == "__main__":
    unittest.main()
