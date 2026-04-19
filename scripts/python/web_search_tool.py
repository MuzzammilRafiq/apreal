from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from typing import Any

import httpx
import trafilatura
from ddgs import DDGS


DEFAULT_HEADERS = {"User-Agent": "Mozilla/5.0"}


@dataclass(slots=True)
class SearchHit:
    title: str
    url: str
    snippet: str
    rank: int


@dataclass(slots=True)
class WebChunk:
    title: str
    url: str
    rank: int
    chunk_id: int
    text: str


@dataclass(slots=True)
class SearchFailure:
    stage: str
    url: str
    error: str


@dataclass(slots=True)
class WebSearchResponse:
    query: str
    hits: list[SearchHit]
    chunks: list[WebChunk]
    failures: list[SearchFailure]

    def to_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "hits": [asdict(hit) for hit in self.hits],
            "chunks": [asdict(chunk) for chunk in self.chunks],
            "failures": [asdict(failure) for failure in self.failures],
        }


def _normalize_whitespace(text: str) -> str:
    lines = [line.strip() for line in text.splitlines()]
    paragraphs = [line for line in lines if line]
    return "\n\n".join(paragraphs)


def _chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    if not text:
        return []
    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be smaller than chunk_size")

    paragraphs = [segment.strip() for segment in text.split("\n\n") if segment.strip()]
    if not paragraphs:
        return []

    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        candidate = paragraph if not current else f"{current}\n\n{paragraph}"
        if len(candidate) <= chunk_size:
            current = candidate
            continue

        if current:
            chunks.append(current)
            overlap = current[-chunk_overlap:].strip()
            current = f"{overlap}\n\n{paragraph}" if overlap else paragraph
        else:
            start = 0
            step = chunk_size - chunk_overlap
            while start < len(paragraph):
                piece = paragraph[start : start + chunk_size].strip()
                if piece:
                    chunks.append(piece)
                start += step
            current = ""

    if current:
        chunks.append(current)

    deduped: list[str] = []
    for chunk in chunks:
        normalized = chunk.strip()
        if normalized and normalized not in deduped:
            deduped.append(normalized)
    return deduped


def duckduckgo_search(query: str, max_results: int = 5) -> list[SearchHit]:
    with DDGS() as ddgs:
        raw_results = list(ddgs.text(query, max_results=max_results))

    hits: list[SearchHit] = []
    seen_urls: set[str] = set()
    for item in raw_results:
        url = item.get("href", "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        hits.append(
            SearchHit(
                title=item.get("title", "").strip() or url,
                url=url,
                snippet=item.get("body", "").strip(),
                rank=len(hits) + 1,
            )
        )
    return hits


async def _fetch_one(
    client: httpx.AsyncClient,
    hit: SearchHit,
) -> tuple[SearchHit, str | None, SearchFailure | None]:
    try:
        response = await client.get(hit.url)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        return hit, None, SearchFailure(stage="fetch", url=hit.url, error=str(exc))

    content_type = response.headers.get("content-type", "")
    if "html" not in content_type and "xml" not in content_type and "text/plain" not in content_type:
        return hit, None, SearchFailure(
            stage="fetch",
            url=hit.url,
            error=f"unsupported content type: {content_type or 'unknown'}",
        )

    return hit, response.text, None


async def _fetch_pages(
    hits: list[SearchHit],
    timeout_seconds: float,
) -> tuple[list[tuple[SearchHit, str]], list[SearchFailure]]:
    timeout = httpx.Timeout(timeout_seconds, connect=timeout_seconds)
    async with httpx.AsyncClient(
        follow_redirects=True,
        headers=DEFAULT_HEADERS,
        timeout=timeout,
    ) as client: 
        tasks = [_fetch_one(client, hit) for hit in hits]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    pages: list[tuple[SearchHit, str]] = []
    failures: list[SearchFailure] = []

    for result, hit in zip(results, hits, strict=True):
        if isinstance(result, Exception):
            failures.append(SearchFailure(stage="fetch", url=hit.url, error=str(result)))
            continue
        result_hit, html, failure = result
        if failure is not None:
            failures.append(failure)
            continue
        if html is None:
            failures.append(SearchFailure(stage="fetch", url=result_hit.url, error="empty response body"))
            continue
        pages.append((result_hit, html))

    return pages, failures


def _extract_chunks(
    pages: list[tuple[SearchHit, str]],
    chunk_size: int,
    chunk_overlap: int,
    max_chunks_per_page: int,
) -> tuple[list[WebChunk], list[SearchFailure]]:
    chunks: list[WebChunk] = []
    failures: list[SearchFailure] = []

    for hit, html in pages:
        extracted = trafilatura.extract(
            html,
            output_format="txt",
            include_comments=False,
            include_images=False,
            include_links=False,
        )
        if not extracted:
            failures.append(SearchFailure(stage="extract", url=hit.url, error="trafilatura returned no text"))
            continue

        normalized = _normalize_whitespace(extracted)
        page_chunks = _chunk_text(normalized, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
        if not page_chunks:
            failures.append(SearchFailure(stage="chunk", url=hit.url, error="no chunkable text"))
            continue

        for chunk_index, chunk in enumerate(page_chunks[:max_chunks_per_page], start=1):
            chunks.append(
                WebChunk(
                    title=hit.title,
                    url=hit.url,
                    rank=hit.rank,
                    chunk_id=chunk_index,
                    text=chunk,
                )
            )

    return chunks, failures


async def async_search_web(
    query: str,
    *,
    max_results: int = 5,
    max_chunks_per_page: int = 3,
    chunk_size: int = 1400,
    chunk_overlap: int = 200,
    timeout_seconds: float = 10.0,
) -> WebSearchResponse:
    hits = duckduckgo_search(query, max_results=max_results)
    pages, fetch_failures = await _fetch_pages(hits, timeout_seconds=timeout_seconds)
    chunks, extract_failures = _extract_chunks(
        pages,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        max_chunks_per_page=max_chunks_per_page,
    )
    return WebSearchResponse(
        query=query,
        hits=hits,
        chunks=chunks,
        failures=[*fetch_failures, *extract_failures],
    )


def search_web(
    query: str,
    *,
    max_results: int = 5,
    max_chunks_per_page: int = 3,
    chunk_size: int = 1400,
    chunk_overlap: int = 200,
    timeout_seconds: float = 10.0,
) -> WebSearchResponse:
    return asyncio.run(
        async_search_web(
            query,
            max_results=max_results,
            max_chunks_per_page=max_chunks_per_page,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            timeout_seconds=timeout_seconds,
        )
    )