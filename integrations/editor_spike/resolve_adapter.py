"""Resolve Studio Phase 0 adapter; uses only original paths, no activity writes."""
import argparse
import getpass
import json
import ntpath
import os
from pathlib import Path
import sys
import subprocess
import time
import uuid

from client import Client


def connect():
    if sys.platform == "win32":
        # This installed native DLL can crash Python if Resolve is not running.
        tasklist = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/tasklist.exe"
        processes = subprocess.run([str(tasklist), "/FI", "IMAGENAME eq Resolve.exe", "/FO", "CSV", "/NH"],
                                   capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
        if processes.returncode or '"resolve.exe"' not in processes.stdout.lower():
            raise RuntimeError("Resolve is closed. Open Resolve Studio and a project, then retry.")
    module_dir = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Blackmagic Design/DaVinci Resolve/Support/Developer/Scripting/Modules"
    sys.path.insert(0, str(module_dir))
    try:
        import DaVinciResolveScript
        resolve = DaVinciResolveScript.scriptapp("Resolve")
    except (ImportError, OSError) as exc:
        raise RuntimeError(f"Resolve scripting API unavailable: {exc}") from exc
    if not resolve:
        raise RuntimeError("Open Resolve Studio. In Preferences > System > General, set External scripting using to Local, then restart Resolve if requested.")
    return resolve


def project_info(resolve):
    project = resolve.GetProjectManager().GetCurrentProject()
    return project, (project.GetUniqueId() if project else ""), (project.GetName() if project else "")


def key(path):
    return ntpath.normcase(ntpath.normpath(path))


def ensure_folder(pool, parent, name):
    folder = next((f for f in (parent.GetSubFolderList() or []) if f.GetName() == name), None)
    folder = folder or pool.AddSubFolder(parent, name)
    if not folder:
        raise RuntimeError(f"Could not create Media Pool folder: {name}")
    return folder


def import_job(resolve, job):
    results = []
    pool, previous = None, None
    try:
        project, project_id, _ = project_info(resolve)
        if project_id != job["project_id"]:
            raise RuntimeError("Active project changed before import")
        pool = project.GetMediaPool()
        previous = pool.GetCurrentFolder()
        parent = ensure_folder(pool, pool.GetRootFolder(), "B-roll Vault")
        target = ensure_folder(pool, parent, job["bin_name"])
        if not pool.SetCurrentFolder(target):
            raise RuntimeError("Could not select target Media Pool folder")
        for item in job["items"]:
            result = {"clip_id": item["clip_id"], "status": "failed", "message": ""}
            try:
                if item["status"] == "missing" or not Path(item["path"]).is_file():
                    result["status"] = "missing"
                elif project_info(resolve)[1] != job["project_id"]:
                    raise RuntimeError("Active project changed during import")
                else:
                    def present():
                        return any(key(c.GetClipProperty("File Path") or "") == key(item["path"])
                                   for c in (target.GetClipList() or []))
                    if present():
                        result["status"] = "existing"
                    else:
                        if not pool.SetCurrentFolder(target):
                            raise RuntimeError("Target folder is no longer selectable")
                        pool.ImportMedia([item["path"]])
                        if not present():
                            raise RuntimeError("Import was not confirmed in the target folder")
                        result["status"] = "imported"
            except Exception as exc:
                result["message"] = str(exc)
            results.append(result)
    except Exception as exc:
        results = [{"clip_id": i["clip_id"], "status": "missing" if i["status"] == "missing" else "failed",
                    "message": str(exc)} for i in job["items"]]
    finally:
        if pool and previous:
            try:
                if not pool.SetCurrentFolder(previous):
                    print("Warning: Resolve could not restore the previous Media Pool folder", file=sys.stderr)
            except Exception as exc:
                print(f"Warning: previous folder could not be restored: {exc}", file=sys.stderr)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--diagnose", action="store_true")
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()
    resolve = connect()
    if args.diagnose:
        _, project_id, name = project_info(resolve)
        print(json.dumps({"product": resolve.GetProductName(), "version": resolve.GetVersionString(),
                          "project_id": project_id, "project_name": name}, indent=2))
        return
    client = Client(getpass.getpass("Vault runtime token: "), args.port)
    client_id = uuid.uuid4().hex
    pending = None
    print("Resolve adapter connected. Keep this running during the spike; Ctrl+C stops it.")
    while True:
        try:
            # Retry the receipt without re-executing media import if transport fails.
            if pending:
                client.call("result", **pending)
                print(json.dumps(pending, indent=2))
                pending = None
            _, project_id, name = project_info(resolve)
            client.call("heartbeat", editor="resolve", client_id=client_id,
                        version=resolve.GetVersionString(), project_id=project_id, project_name=name)
            if project_id:
                job = client.call("claim", editor="resolve", client_id=client_id, project_id=project_id)["job"]
                if job:
                    pending = {"editor": "resolve", "client_id": client_id, "job_id": job["id"],
                               "claim_id": job["claim_id"], "project_id": job["project_id"],
                               "items": import_job(resolve, job)}
        except (RuntimeError, OSError) as exc:
            print(f"Connection/receipt needs attention: {exc}", file=sys.stderr)
        time.sleep(2)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (RuntimeError, OSError) as exc:
        raise SystemExit(str(exc))
