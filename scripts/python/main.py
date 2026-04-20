from __future__ import annotations

import argparse
import json

from web_search_tool import search_web_merged


DEFAULT_MAX_RESULTS = 2
DEFAULT_MAX_CHUNKS_PER_PAGE = 10


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a DuckDuckGo + fetch + extract web search pipeline.")
    parser.add_argument("query", nargs="?", default="open source llm agents")
    args = parser.parse_args()

    result = search_web_merged(
        args.query,
      max_results=DEFAULT_MAX_RESULTS,
      max_chunks_per_page=DEFAULT_MAX_CHUNKS_PER_PAGE,
    )
    print(json.dumps(result, indent=2, ensure_ascii=True))
    # prints json like
    '''
    [
      {
        "url": "...",
        "title": "...",
        "text": "...."
      },
      {
        "url": "...",
        "title": "...",
        "text": "...."
      }
      .... max_results times
    ]
    '''


if __name__ == "__main__":
    main()