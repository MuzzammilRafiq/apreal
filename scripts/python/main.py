from __future__ import annotations

import argparse
import json

from web_search_tool import search_web


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a DuckDuckGo + fetch + extract web search pipeline.")
    parser.add_argument("query", nargs="?", default="open source llm agents")
    parser.add_argument("--max-results", type=int, default=2)
    parser.add_argument("--max-chunks-per-page", type=int, default=7)
    args = parser.parse_args()

    result = search_web(
        args.query,
        max_results=args.max_results,
        max_chunks_per_page=args.max_chunks_per_page,
    )
    print(json.dumps(result.to_dict(), indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()