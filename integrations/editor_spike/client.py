"""Manual Phase 0 driver. Pair with the runtime token printed by the backend."""
import argparse
import getpass
import json
import urllib.error
import urllib.request


class Client:
    def __init__(self, token, port=8010):
        self.token, self.port = token, port
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(self, action, **body):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/spike/{action}",
            json.dumps(body).encode(),
            {"Content-Type": "application/json", "Authorization": "Bearer " + self.token})
        try:
            with self.http.open(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(json.load(exc).get("error", str(exc))) from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["status", "send"])
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--editor", choices=["premiere", "resolve"])
    parser.add_argument("--ids", type=int, nargs="+")
    parser.add_argument("--bin", default="Vault Phase 0")
    args = parser.parse_args()
    if args.command == "send" and (not args.editor or not args.ids):
        parser.error("send requires --editor and --ids")
    client = Client(getpass.getpass("Vault runtime token: "), args.port)
    status = client.call("status")
    if args.command == "status":
        print(json.dumps(status, indent=2))
        return
    peer = status["editors"].get(args.editor)
    if not peer or not peer["connected"] or not peer["project_id"]:
        raise RuntimeError("Connect the adapter and open an editor project first")
    print(f"Send catalog IDs {args.ids} to {args.editor}: {peer['project_name']} / B-roll Vault / {args.bin}")
    if input("Type SEND to queue this import: ") != "SEND":
        print("Cancelled")
        return
    print(json.dumps(client.call("jobs", editor=args.editor, project_id=peer["project_id"],
                                 bin_name=args.bin, clip_ids=args.ids), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as exc:
        raise SystemExit(str(exc))
