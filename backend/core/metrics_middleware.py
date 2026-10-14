"""
ASGI middleware that records request metrics for the Analytics page.

Deliberately measures at the ASGI layer rather than inside routers: it captures
401s from the auth dependency and 500s from anywhere, which is exactly the
traffic the error-rate chart is supposed to show.
"""

from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from backend.core import metrics

logger = logging.getLogger(__name__)


def _project_id(request: Request) -> str | None:
    """
    Resolve the project for this request.

    ``get_project_context`` attaches the resolved project to request.state, so
    by the time the response is on its way out the id is available. Requests
    that never resolve a project are not attributable and are not recorded.
    """
    project = getattr(request.state, "project", None)
    if isinstance(project, dict):
        pid = project.get("id")
        if pid:
            return str(pid)
    return None


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            # An unhandled exception is a 500 by definition. Record it, then let
            # the app's exception handlers turn it into a response.
            duration_ms = (time.perf_counter() - started) * 1000
            self._record(request, 500, duration_ms)
            raise

        duration_ms = (time.perf_counter() - started) * 1000
        self._record(request, response.status_code, duration_ms)
        return response

    def _record(self, request: Request, status_code: int, duration_ms: float) -> None:
        try:
            route = request.scope.get("route")
            template = getattr(route, "path", None)
            metrics.record(
                project_id=_project_id(request),
                method=request.method,
                path=request.url.path,
                route_template=template,
                status_code=status_code,
                duration_ms=duration_ms,
            )
        except Exception:
            # Metrics must never break a request.
            logger.debug("Metric recording failed", exc_info=True)