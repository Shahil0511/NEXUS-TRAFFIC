"""
Data Nexus Traffic - reference ASGI middleware for FastAPI / Starlette (Python 3.10+).

Copy this file into your backend (e.g. app/nexus_asgi.py). One dependency: httpx (async client).

WHY a pure ASGI class (not BaseHTTPMiddleware): BaseHTTPMiddleware runs the endpoint in a child task,
so context variables set inside (request id, signed-in user) are invisible to it, and it buffers
streaming responses. A pure ASGI class adds no task and no buffering.

It NEVER raises into your app and NEVER blocks a response: events are queued and sent in the
background; if Nexus is down they are dropped after the retry rules below.

    from app.nexus_asgi import NexusClient, NexusASGIMiddleware

    nexus = NexusClient(url=os.getenv("NEXUS_URL"), key=os.getenv("NEXUS_SECRET_KEY"))
    app.add_middleware(
        NexusASGIMiddleware,
        client=nexus,
        base_path="/my-app",          # public prefix your gateway strips ("" if none)
        trust_proxy_hops=2,           # REQUIRED: gateway -> Next -> api = 2; gateway -> api = 1
        get_user=lambda scope: user_email_ctx.get(),   # your VERIFIED user, read at response end
    )
    # on shutdown (lifespan):  await nexus.aclose()

Starlette ordering: the LAST middleware added is the OUTERMOST. To read context variables that
another middleware sets (e.g. request_context_middleware), add THIS middleware BEFORE that one, so
it runs inside it.

Contract: https://nexus.libas.in/traffic/api/docs/
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, MutableMapping, Optional

import httpx

# --- Contract constants (v1) -------------------------------------------------
SERVER_INGEST_PATH = "/api/v1/ingest/server"
KEY_HEADER = "X-Nexus-Key"
MAX_EVENTS_PER_REQUEST = 500
MAX_PATH = 2048
MAX_ROUTE_TEMPLATE = 256
MAX_EMAIL = 254
MAX_USER_AGENT = 4096
MAX_REQUEST_ID = 128
MAX_DURATION_MS = 3_600_000
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE
)
ERROR_CODE_PATTERN = re.compile(r"^[A-Z0-9_]{1,64}$")
ROUTE_PARAM = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)(?::[^}]*)?\}")

# --- Batching / retry defaults -----------------------------------------------
FLUSH_EVERY_EVENTS = 100
FLUSH_INTERVAL_S = 5.0
MAX_QUEUE = 5000
REQUEST_TIMEOUT_S = 5.0
MAX_ATTEMPTS = 3
BACKOFF_S = (1.0, 2.0, 4.0)
AUTH_PAUSE_S = 300.0
DEFAULT_RETRY_AFTER_S = 5.0
MAX_RETRY_AFTER_S = 60.0

SKIP_SUFFIXES = ("/health", "/healthz", "/ready", "/live", "/metrics", "/favicon.ico")
SKIP_EXTENSIONS = re.compile(r"\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf)$", re.I)

logger = logging.getLogger("nexus")

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


# --- Helpers -------------------------------------------------------------------


def _iso_now() -> str:
    """UTC ISO-8601 with milliseconds and a Z suffix, e.g. 2026-10-01T04:00:12.345Z."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _normalize_ip(value: str) -> str:
    v = value.strip()
    return v[7:] if v.lower().startswith("::ffff:") and "." in v else v


def resolve_client_ip(
    x_forwarded_for: Optional[str], remote_address: Optional[str], trust_proxy_hops: int
) -> Optional[str]:
    """End-user IP, walking X-Forwarded-For from the RIGHT. NEVER the leftmost entry."""
    chain = [_normalize_ip(p) for p in (x_forwarded_for or "").split(",") if p.strip()]
    if remote_address:
        chain.append(_normalize_ip(remote_address))
    if not chain:
        return None
    return chain[max(0, len(chain) - 1 - max(0, int(trust_proxy_hops)))]


def _with_base_path(base_path: str, path: str) -> str:
    if not base_path or path == base_path or path.startswith(base_path + "/"):
        return path
    return (base_path + ("" if path == "/" else path)) or "/"


def _header(scope: Scope, name: bytes) -> Optional[str]:
    """All values of a header joined by ',' (ASGI keeps duplicates as separate entries)."""
    values = [v.decode("latin-1") for k, v in scope.get("headers", []) if k.lower() == name]
    return ",".join(values) if values else None


def _optional_str(value: Any, max_len: int) -> Optional[str]:
    return value if isinstance(value, str) and 0 < len(value) <= max_len else None


def _optional_uuid(value: Optional[str]) -> Optional[str]:
    return value if value and UUID_PATTERN.match(value) else None


def _optional_int(value: Optional[str]) -> Optional[int]:
    try:
        n = int(value) if value is not None else None
    except ValueError:
        return None
    return n if n is not None and n >= 0 else None


def _default_skip(scope: Scope) -> bool:
    path = scope.get("path", "")
    return scope.get("method") == "OPTIONS" or path.endswith(SKIP_SUFFIXES) or bool(SKIP_EXTENSIONS.search(path))


# --- Client: queue + batching + retries ----------------------------------------


class NexusClient:
    """
    Batches events: flush every 5 s or every 100 events, at most 500 per request.
    Retry rules (guide chapter 4): 202 done - 400/415 drop - 401/403 pause 5 min - 413 split -
    429/503 honour Retry-After - 5xx/network back off 1/2/4 s, max 3 attempts - 3xx/HTML = proxy.
    Without url or key it is a no-op.
    """

    def __init__(
        self,
        url: Optional[str],
        key: Optional[str],
        sdk_name: str = "nexus-snippet-fastapi",
        sdk_version: str = "1.0.0",
    ) -> None:
        self._enabled = bool(url and key)
        self._endpoint = (url or "").rstrip("/") + SERVER_INGEST_PATH
        self._key = key or ""
        self._sdk = {"name": sdk_name, "version": sdk_version}
        self._queue: list[dict[str, Any]] = []
        self._dropped = 0
        self._paused_until = 0.0
        self._lock = asyncio.Lock()
        self._task: Optional[asyncio.Task[None]] = None
        self._http: Optional[httpx.AsyncClient] = None

    # -- public --------------------------------------------------------------
    def track(self, event: dict[str, Any]) -> None:
        """Queue one event. Safe to call from any coroutine; never raises."""
        if not self._enabled:
            return
        try:
            self._enqueue([event], at_front=False)
            self._ensure_timer()
            if len(self._queue) >= FLUSH_EVERY_EVENTS:
                asyncio.get_running_loop().create_task(self.flush())
        except Exception:  # noqa: BLE001 - never raise into the app
            pass

    async def flush(self) -> None:
        if not self._enabled or self._lock.locked():
            return
        async with self._lock:
            try:
                while self._queue and time.monotonic() >= self._paused_until:
                    batch = self._queue[:MAX_EVENTS_PER_REQUEST]
                    del self._queue[:MAX_EVENTS_PER_REQUEST]
                    await self._deliver(batch)
            except Exception:  # noqa: BLE001
                logger.warning("[nexus] flush failed", exc_info=False)

    async def aclose(self) -> None:
        """Call from your shutdown/lifespan hook: flushes what is queued."""
        if self._task:
            self._task.cancel()
        self._paused_until = 0.0
        await self.flush()
        if self._http:
            await self._http.aclose()

    def stats(self) -> dict[str, int]:
        return {"queued": len(self._queue), "dropped": self._dropped}

    # -- internals ---------------------------------------------------------
    def _enqueue(self, events: list[dict[str, Any]], at_front: bool) -> None:
        self._queue = events + self._queue if at_front else self._queue + events
        overflow = len(self._queue) - MAX_QUEUE
        if overflow > 0:
            del self._queue[:overflow]
            self._dropped += overflow

    def _ensure_timer(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run())

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_S)
            await self.flush()

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S, follow_redirects=False)
        return self._http

    async def _post(self, events: list[dict[str, Any]]) -> httpx.Response:
        # sentAt is re-stamped on EVERY attempt; events (eventId, occurredAt) are resent unchanged.
        body = {"sentAt": _iso_now(), "sdk": self._sdk, "events": events}
        return await self._client().post(
            self._endpoint, json=body, headers={KEY_HEADER: self._key}
        )

    @staticmethod
    def _retry_after_s(response: httpx.Response) -> float:
        try:
            seconds = float(response.headers.get("retry-after", DEFAULT_RETRY_AFTER_S))
        except ValueError:
            seconds = DEFAULT_RETRY_AFTER_S
        return min(max(seconds, 0.0), MAX_RETRY_AFTER_S)

    async def _deliver(self, events: list[dict[str, Any]]) -> None:
        for attempt in range(MAX_ATTEMPTS):
            try:
                response = await self._post(events)
            except httpx.HTTPError:
                await asyncio.sleep(BACKOFF_S[attempt])
                continue
            status = response.status_code
            is_html = "text/html" in response.headers.get("content-type", "")
            if status == 202:
                return  # committed - NEVER retry a 202
            if 300 <= status < 400 or is_html:
                logger.warning("[nexus] HTTP %s: a proxy/SSO is intercepting; %d events dropped", status, len(events))
                return
            if status == 413 and len(events) > 1:
                middle = (len(events) + 1) // 2
                await self._deliver(events[:middle])
                await self._deliver(events[middle:])
                return
            if status in (401, 403):
                self._paused_until = time.monotonic() + AUTH_PAUSE_S
                self._enqueue(events, at_front=True)
                logger.warning("[nexus] HTTP %s: key rejected - pausing 5 minutes", status)
                return
            if status in (429, 503):
                await asyncio.sleep(self._retry_after_s(response))
                continue
            if status >= 500:
                await asyncio.sleep(BACKOFF_S[attempt])
                continue
            logger.warning("[nexus] HTTP %s: batch refused (fix the sender); %d events dropped", status, len(events))
            return
        logger.warning("[nexus] gave up after %d attempts; %d events dropped", MAX_ATTEMPTS, len(events))


# --- Middleware ----------------------------------------------------------------


class NexusASGIMiddleware:
    """One server event per HTTP request, built when the response has been sent."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        client: NexusClient,
        trust_proxy_hops: int,
        base_path: str = "",
        get_user: Optional[Callable[[Scope], Optional[str]]] = None,
        get_error_code: Optional[Callable[[Scope], Optional[str]]] = None,
        skip: Callable[[Scope], bool] = _default_skip,
        release: Optional[str] = None,
    ) -> None:
        if not isinstance(trust_proxy_hops, int):
            raise ValueError("NexusASGIMiddleware: set trust_proxy_hops explicitly")
        self.app = app
        self.client = client
        self.trust_proxy_hops = trust_proxy_hops
        self.base_path = base_path.rstrip("/")
        self.get_user = get_user
        self.get_error_code = get_error_code
        self.skip = skip
        self.release = release

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http" or self._safe(lambda: self.skip(scope), True):
            await self.app(scope, receive, send)
            return

        occurred_at = _iso_now()  # request START
        started = time.perf_counter()
        response: dict[str, Any] = {"status": 500, "bytes": None, "stream": False}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                response["status"] = message["status"]
                headers = {k.lower(): v for k, v in message.get("headers", [])}
                response["bytes"] = _optional_int(headers.get(b"content-length", b"").decode() or None)
                content_type = headers.get(b"content-type", b"").decode()
                disposition = headers.get(b"content-disposition", b"").decode()
                response["stream"] = "text/event-stream" in content_type or disposition.startswith("attachment")
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            self._safe(lambda: self.client.track(self._build(scope, response, occurred_at, duration_ms)), None)

    @staticmethod
    def _safe(fn: Callable[[], Any], fallback: Any) -> Any:
        try:
            return fn()
        except Exception:  # noqa: BLE001 - never raise into the app
            return fallback

    def _route_template(self, scope: Scope) -> Optional[str]:
        route = scope.get("route")  # set by FastAPI routing on the shared scope
        template = getattr(route, "path_format", None) or getattr(route, "path", None)
        if not isinstance(template, str):
            return None  # unmatched route: the server guesses
        # Same style as the Express snippets: {store_id} / {path:path} -> :store_id / :path
        full = ROUTE_PARAM.sub(r":\1", scope.get("root_path", "") + template)
        return _with_base_path(self.base_path, full)[:MAX_ROUTE_TEMPLATE]

    def _build(
        self, scope: Scope, response: dict[str, Any], occurred_at: str, duration_ms: float
    ) -> dict[str, Any]:
        client_addr = scope.get("client")
        error_code = self._safe(lambda: self.get_error_code(scope), None) if self.get_error_code else None
        path = scope.get("root_path", "") + scope.get("path", "/")  # ASGI path never has the query
        event: dict[str, Any] = {
            "eventId": str(uuid.uuid4()),
            "kind": "stream" if response["stream"] else "http",
            "occurredAt": occurred_at,
            "method": scope.get("method", "GET"),
            "path": _with_base_path(self.base_path, path)[:MAX_PATH],
            "routeTemplate": self._route_template(scope),
            "status": response["status"],
            "durationMs": min(round(duration_ms, 1), MAX_DURATION_MS),
            "ip": resolve_client_ip(
                _header(scope, b"x-forwarded-for"),
                client_addr[0] if client_addr else None,
                self.trust_proxy_hops,
            ),
            "userEmail": _optional_str(self._safe(lambda: self.get_user(scope), None), MAX_EMAIL)
            if self.get_user
            else None,
            "requestId": _optional_str(_header(scope, b"x-request-id"), MAX_REQUEST_ID),
            "userAgent": _optional_str(_header(scope, b"user-agent"), MAX_USER_AGENT),
            "requestBytes": _optional_int(_header(scope, b"content-length")),
            "responseBytes": response["bytes"],
            "errorCode": error_code if isinstance(error_code, str) and ERROR_CODE_PATTERN.match(error_code) else None,
            "release": _optional_str(self.release, 64),
            "sessionId": _optional_uuid(_header(scope, b"x-nexus-session")),
            "pageViewId": _optional_uuid(_header(scope, b"x-nexus-page-view")),
        }
        return {k: v for k, v in event.items() if v is not None}
