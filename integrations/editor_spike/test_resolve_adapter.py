from pathlib import Path
import tempfile
import unittest
from resolve_adapter import import_job, key


class Folder:
    def __init__(self, name):
        self.name, self.folders, self.clips = name, [], []
    def GetName(self): return self.name
    def GetSubFolderList(self): return self.folders
    def GetClipList(self): return self.clips


class Clip:
    def __init__(self, path): self.path = path
    def GetClipProperty(self, name): return self.path


class Pool:
    def __init__(self):
        self.root = Folder("Root")
        self.current = self.root
        self.calls = []
    def GetCurrentFolder(self): return self.current
    def GetRootFolder(self): return self.root
    def SetCurrentFolder(self, folder): self.current = folder; return True
    def AddSubFolder(self, parent, name):
        folder = Folder(name); parent.folders.append(folder); return folder
    def ImportMedia(self, paths):
        self.calls.extend(paths)
        if "fail" in paths[0]: return []
        self.current.clips.append(Clip(paths[0])); return [self.current.clips[-1]]


class Resolve:
    def __init__(self): self.pool = Pool(); self.project_id = "p1"
    def GetProjectManager(self): return self
    def GetCurrentProject(self): return self if self.project_id else None
    def GetUniqueId(self): return self.project_id
    def GetName(self): return "Test"
    def GetMediaPool(self): return self.pool


class ResolveTests(unittest.TestCase):
    def test_partial_duplicate_and_restores_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = [str(Path(tmp) / name) for name in ("good.mov", "fail.mov", "missing.mov")]
            for path in paths[:2]: Path(path).write_bytes(b"fixture")
            job = {"project_id": "p1", "bin_name": "Test", "items": [
                {"clip_id": i, "path": path, "status": "pending"} for i, path in enumerate(paths)]}
            resolve = Resolve()
            self.assertEqual([i["status"] for i in import_job(resolve, job)], ["imported", "failed", "missing"])
            self.assertIs(resolve.pool.current, resolve.pool.root)
            self.assertEqual([i["status"] for i in import_job(resolve, job)], ["existing", "failed", "missing"])
            self.assertEqual(resolve.pool.calls.count(paths[0]), 1)
            self.assertEqual(Path(paths[0]).read_bytes(), b"fixture")

    def test_project_changed_does_not_import(self):
        resolve = Resolve()
        result = import_job(resolve, {"project_id": "other", "bin_name": "Test", "items": [
            {"clip_id": 1, "path": "anything.mov", "status": "pending"}]})
        self.assertEqual(result[0]["status"], "failed")
        self.assertEqual(resolve.pool.calls, [])
        self.assertEqual(resolve.pool.root.folders, [])

    def test_windows_unc_normalization(self):
        self.assertEqual(key(r"\\SERVER\Share\Clip.MOV"), key("//server/share/clip.mov"))


if __name__ == "__main__": unittest.main()
