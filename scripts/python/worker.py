from __future__ import annotations

import json
import signal
import sys
from typing import Any

from web_search_tool import search_web_merged


running = True


def _handle_signal(signum: int, frame: Any) -> None:
    global running
    running = False
    raise SystemExit(0)


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT, _handle_signal)


def _process_request(request: dict[str, Any]) -> dict[str, Any]:
    query = request.get("query", "")
    params = request.get("params", {})
    max_results = int(params.get("max_results", 5))
    max_chunks_per_page = int(params.get("max_chunks_per_page", 3))
    chunk_size = int(params.get("chunk_size", 1400))
    chunk_overlap = int(params.get("chunk_overlap", 200))
    timeout_seconds = float(params.get("timeout_seconds", 10.0))
    browser_fallback = bool(params.get("browser_fallback", True))

    result = search_web_merged(
        query,
        max_results=max_results,
        max_chunks_per_page=max_chunks_per_page,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        timeout_seconds=timeout_seconds,
        browser_fallback=browser_fallback,
    )
    return {"ok": True, "results": result}


def main() -> None:
    while running:
        line = sys.stdin.readline()
        if not line:
            break

        line = line.strip()
        if not line:
            continue

        req_id = 0
        try:
            request = json.loads(line)
            req_id = int(request.get("id", 0))
        except Exception as exc:
            response = {"id": req_id, "ok": False, "error": str(exc)}
        else:
            try:
                response = _process_request(request)
                response["id"] = req_id
            except Exception as exc:
                response = {"id": req_id, "ok": False, "error": str(exc)}

        sys.stdout.write(json.dumps(response, ensure_ascii=True) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
