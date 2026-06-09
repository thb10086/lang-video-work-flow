"""Retry the failed multi-camera v0.2 generation via the same /api/generate/image
endpoint, but using Python to bypass any PowerShell JSON-encoding quirks.

Reads 03-prompts.v2.json, finds the multi-camera entry, posts to the backend,
downloads the result PNG to images-v2/, and appends a one-line summary."""

from __future__ import annotations

import json
import time
import urllib.request
import urllib.error
from pathlib import Path

HERE = Path(__file__).parent
PROMPTS = json.loads((HERE / "03-prompts.v2.json").read_text(encoding="utf-8"))
ENTRY = next(p for p in PROMPTS["prompts"] if p["subType"] == "multi-camera")

body = {
    "model_id": "gpt-image-2",
    "prompt": ENTRY["prompt"],
    "params": {"size": "1024x1024", "resolution": "2048"},
}
data = json.dumps(body).encode("utf-8")
req = urllib.request.Request(
    "http://127.0.0.1:8000/api/generate/image",
    data=data,
    method="POST",
    headers={"Content-Type": "application/json"},
)
start = time.time()
try:
    with urllib.request.urlopen(req, timeout=300) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    elapsed = int(time.time() - start)
    print(f"code={payload.get('code')} msg={payload.get('message')} elapsed={elapsed}s")
    img_url = payload["data"]["images"][0]["url"]
    print(f"url={img_url}")
    out_path = HERE / "images-v2" / "luckin-成品展示-multi-camera-v2.png"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(img_url, out_path)
    print(f"saved -> {out_path} ({out_path.stat().st_size:,} bytes)")
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}: {e.read().decode('utf-8', errors='replace')}")
except Exception as e:  # noqa: BLE001
    print(f"ERROR: {e}")
