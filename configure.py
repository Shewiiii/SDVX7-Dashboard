"""Configure this personal companion without editing the tracker."""
import getpass
import json
import secrets
from pathlib import Path
from urllib.parse import urlparse

root = Path(__file__).resolve().parent
path = root / ".local/sync-config.json"
config = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
url = input("Live dashboard URL (https://your-project.vercel.app): ").strip().rstrip("/")
parsed = urlparse(url)
if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
    raise SystemExit("Use the https origin of your dashboard, without a path.")
config["url"] = url
config["name"] = input(f"Display name [{config.get('name', 'Shewi')}]: ").strip() or config.get("name", "Shewi")
config["token"] = config.get("token") or secrets.token_urlsafe(48)
bypass = getpass.getpass("Vercel automation bypass secret (optional; Enter to skip): ").strip()
if bypass:
    config["bypass"] = bypass
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(config, indent=2), encoding="utf-8")
# A dedicated file makes the value easy to paste into Vercel without logging it.
token_file = path.parent / "sync-token.txt"
token_file.write_text(config["token"], encoding="utf-8")
print("Saved local sync configuration.")
print(f"Set Vercel's SYNC_TOKEN to the contents of {token_file} (do not share this file).")
print("Then redeploy and run: python sync.py --once")
