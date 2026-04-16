"""FastAPI web wrapper for QGI Life-Signals-IQ.

Exposes a browser UI and a small JSON/SSE API around the unchanged
``sherlock_project.sherlock.sherlock`` function. No internal logic is
modified; this module only orchestrates calls in a worker thread and
serializes results for HTTP transport.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import threading
from pathlib import Path
from queue import Empty, Queue
from typing import Any, Iterable, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

from sherlock_project import (
    __longname__,
    __shortname__,
    __upstream_shortname__,
    __version__,
)
from sherlock_project.notify import QueryNotify
from sherlock_project.result import QueryResult, QueryStatus
from sherlock_project.sherlock import sherlock as run_sherlock
from sherlock_project.sites import SitesInformation


BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

app = FastAPI(
    title=__shortname__,
    description=(
        f"{__longname__}. Soft rebrand of {__upstream_shortname__}; "
        "web wrapper that reuses the upstream detection engine unmodified."
    ),
    version=__version__,
)


def _split_csv(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


_CORS_ORIGINS = _split_csv(os.environ.get("LSIQ_CORS_ORIGINS"))
_CORS_ORIGIN_REGEX = os.environ.get("LSIQ_CORS_ORIGIN_REGEX") or None
if _CORS_ORIGINS or _CORS_ORIGIN_REGEX:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_CORS_ORIGINS or [],
        allow_origin_regex=_CORS_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )


_AUTH_TOKEN = os.environ.get("LSIQ_AUTH_TOKEN") or None
_AUTH_PUBLIC_PATHS = {
    "/",
    "/api/health",
    "/api/meta",
    "/favicon.ico",
}


class BearerAuthMiddleware(BaseHTTPMiddleware):
    """Opt-in bearer-token gate for the API.

    Enabled when ``LSIQ_AUTH_TOKEN`` is set in the environment. Public
    marketing/health paths stay open; static assets stay open; everything
    under ``/api/*`` requires ``Authorization: Bearer <token>``.
    """

    async def dispatch(self, request: Request, call_next):
        if _AUTH_TOKEN is None:
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)
        path = request.url.path
        if path in _AUTH_PUBLIC_PATHS or path.startswith("/static/"):
            return await call_next(request)
        if not path.startswith("/api/"):
            return await call_next(request)
        header = request.headers.get("authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or token.strip() != _AUTH_TOKEN:
            return StarletteResponse(
                content=json.dumps({"detail": "unauthorized"}),
                status_code=401,
                media_type="application/json",
                headers={"WWW-Authenticate": 'Bearer realm="lsiq"'},
            )
        return await call_next(request)


app.add_middleware(BearerAuthMiddleware)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.\-{}?]{1,64}$")


_sites_cache: Optional[SitesInformation] = None
_sites_cache_lock = threading.Lock()


def _load_sites() -> SitesInformation:
    """Load and cache the sites manifest.

    Tries the upstream live manifest first (fresh exclusions) and falls back
    to the bundled ``resources/data.json`` if offline.
    """
    global _sites_cache
    with _sites_cache_lock:
        if _sites_cache is not None:
            return _sites_cache
        try:
            _sites_cache = SitesInformation(data_file_path=None)
        except Exception:
            local = (
                Path(__file__).resolve().parent.parent / "resources" / "data.json"
            )
            _sites_cache = SitesInformation(
                data_file_path=str(local), honor_exclusions=False
            )
        return _sites_cache


def _sites_to_dict(
    sites: SitesInformation,
    only: Optional[Iterable[str]] = None,
    include_nsfw: bool = False,
) -> dict[str, dict[str, Any]]:
    """Convert a SitesInformation into the dict shape expected by
    ``run_sherlock``. Optionally filter down to a subset by site name
    (case-insensitive) and exclude NSFW sites by default.
    """
    wanted: Optional[set[str]] = None
    if only:
        wanted = {s.strip().lower() for s in only if s and s.strip()}

    out: dict[str, dict[str, Any]] = {}
    for site in sites:
        if not include_nsfw and getattr(site, "is_nsfw", False):
            continue
        if wanted is not None and site.name.lower() not in wanted:
            continue
        out[site.name] = dict(site.information)
    return out


class QueueNotify(QueryNotify):
    """QueryNotify implementation that pushes events into a thread-safe queue.

    The web layer consumes these events and converts them into SSE messages.
    """

    def __init__(self, q: "Queue[dict[str, Any]]") -> None:
        super().__init__()
        self._q = q

    def start(self, message: Optional[str] = None) -> None:
        self._q.put({"type": "start", "username": message})

    def update(self, result: QueryResult) -> None:
        self._q.put(
            {
                "type": "result",
                "site": result.site_name,
                "url": result.site_url_user,
                "status": str(result.status),
                "status_key": result.status.name,
                "context": result.context,
                "query_time": result.query_time,
            }
        )

    def finish(self, message: Optional[Any] = None) -> None:
        self._q.put({"type": "finish", "count": message})


class SearchRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    sites: Optional[list[str]] = Field(
        default=None,
        description="Optional subset of site names (case-insensitive). "
        "Defaults to all bundled SFW sites.",
    )
    timeout: int = Field(default=30, ge=1, le=180)
    include_nsfw: bool = False
    only_found: bool = True


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "name": __shortname__,
        "version": __version__,
        "upstream": __upstream_shortname__,
    }


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    sites = _load_sites()
    names = sorted({site.name for site in sites}, key=str.lower)
    return {
        "name": __shortname__,
        "long_name": __longname__,
        "version": __version__,
        "upstream": __upstream_shortname__,
        "site_count": len(names),
        "auth_required": _AUTH_TOKEN is not None,
        "cors_configured": bool(_CORS_ORIGINS or _CORS_ORIGIN_REGEX),
    }


@app.get("/api/sites")
def list_sites(include_nsfw: bool = False) -> dict[str, Any]:
    sites = _load_sites()
    items = []
    for site in sites:
        if not include_nsfw and getattr(site, "is_nsfw", False):
            continue
        items.append(
            {
                "name": site.name,
                "url_main": site.url_home,
                "is_nsfw": bool(getattr(site, "is_nsfw", False)),
            }
        )
    items.sort(key=lambda s: s["name"].lower())
    return {"count": len(items), "sites": items}


def _validate_username(username: str) -> str:
    username = username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")
    if not _USERNAME_RE.match(username):
        raise HTTPException(
            status_code=400,
            detail="username must be 1-64 chars; letters, digits, . _ - { } ? only",
        )
    return username


def _run_in_thread(
    username: str,
    site_data: dict[str, dict[str, Any]],
    timeout: int,
    notify: QueueNotify,
    q: "Queue[dict[str, Any]]",
) -> None:
    try:
        run_sherlock(
            username=username,
            site_data=site_data,
            query_notify=notify,
            timeout=timeout,
        )
    except Exception as exc:
        q.put({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
    finally:
        q.put({"type": "done"})


@app.post("/api/search")
def search(req: SearchRequest) -> JSONResponse:
    """Blocking JSON endpoint: runs the search to completion then returns."""
    username = _validate_username(req.username)
    sites = _load_sites()
    site_data = _sites_to_dict(
        sites, only=req.sites, include_nsfw=req.include_nsfw
    )
    if not site_data:
        raise HTTPException(status_code=400, detail="no matching sites selected")

    q: "Queue[dict[str, Any]]" = Queue()
    notify = QueueNotify(q)
    worker = threading.Thread(
        target=_run_in_thread,
        args=(username, site_data, req.timeout, notify, q),
        daemon=True,
    )
    worker.start()
    worker.join()

    results: list[dict[str, Any]] = []
    error: Optional[str] = None
    while True:
        try:
            evt = q.get_nowait()
        except Empty:
            break
        if evt["type"] == "result":
            if req.only_found and evt.get("status_key") != "CLAIMED":
                continue
            results.append(evt)
        elif evt["type"] == "error":
            error = evt["message"]

    return JSONResponse(
        {
            "username": username,
            "total_probed": len(site_data),
            "found": len(results),
            "results": results,
            "error": error,
        }
    )


@app.get("/api/search/stream")
async def search_stream(
    request: Request,
    username: str,
    sites: Optional[str] = None,
    timeout: int = 30,
    include_nsfw: bool = False,
) -> StreamingResponse:
    """Server-Sent Events endpoint: streams each probe result as it completes."""
    username = _validate_username(username)
    if not (1 <= timeout <= 180):
        raise HTTPException(status_code=400, detail="timeout must be 1..180")

    site_list = [s for s in (sites or "").split(",") if s.strip()] or None
    all_sites = _load_sites()
    site_data = _sites_to_dict(
        all_sites, only=site_list, include_nsfw=include_nsfw
    )
    if not site_data:
        raise HTTPException(status_code=400, detail="no matching sites selected")

    q: "Queue[dict[str, Any]]" = Queue()
    notify = QueueNotify(q)
    worker = threading.Thread(
        target=_run_in_thread,
        args=(username, site_data, timeout, notify, q),
        daemon=True,
    )
    worker.start()

    async def event_gen():
        yield _sse(
            "meta",
            {"username": username, "total": len(site_data), "version": __version__},
        )
        loop = asyncio.get_running_loop()
        while True:
            if await request.is_disconnected():
                break
            try:
                evt = await loop.run_in_executor(None, q.get, True, 0.5)
            except Empty:
                continue
            kind = evt.get("type")
            if kind == "done":
                yield _sse("done", {})
                break
            yield _sse(kind or "message", evt)

    headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(
        event_gen(), media_type="text/event-stream", headers=headers
    )


def _sse(event: str, data: dict[str, Any]) -> bytes:
    payload = json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "short_name": __shortname__,
            "long_name": __longname__,
            "version": __version__,
            "upstream": __upstream_shortname__,
        },
    )
