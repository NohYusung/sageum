from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


def _required_string(payload: Mapping[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} is required")
    return value.strip()


def normalize_topic(topic: str) -> str:
    normalized = " ".join(topic.split())
    if not normalized:
        raise ValueError("topic is required")
    if len(normalized) > 200:
        raise ValueError("topic must be 200 characters or fewer")
    return normalized


@dataclass(frozen=True)
class JobRequest:
    """Backend-to-agent request contract for one curriculum generation job."""

    job_id: str
    topic: str
    callback_url: str | None = None
    force_refresh: bool = False

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "JobRequest":
        job_id = _required_string(payload, "jobId")
        topic = normalize_topic(_required_string(payload, "topic"))
        callback_url = payload.get("callbackUrl")
        if callback_url is not None:
            if not isinstance(callback_url, str) or not callback_url.strip():
                raise ValueError("callbackUrl must be a non-empty string")
            callback_url = callback_url.strip()
        return cls(
            job_id=job_id,
            topic=topic,
            callback_url=callback_url,
            force_refresh=bool(payload.get("forceRefresh", False)),
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "topic": self.topic,
            "callbackUrl": self.callback_url,
            "forceRefresh": self.force_refresh,
        }


@dataclass(frozen=True)
class JobResult:
    """Agent-to-backend callback contract for job completion or failure."""

    job_id: str
    status: str
    markdown: str | None = None
    html: str | None = None
    sources: list[dict[str, Any]] = field(default_factory=list)
    cache_hit: bool = False
    error: str | None = None

    @classmethod
    def completed(
        cls,
        *,
        job_id: str,
        markdown: str,
        html: str,
        sources: list[dict[str, Any]] | None = None,
        cache_hit: bool = False,
    ) -> "JobResult":
        if not markdown:
            raise ValueError("markdown is required for completed jobs")
        if not html:
            raise ValueError("html is required for completed jobs")
        return cls(
            job_id=job_id,
            status="completed",
            markdown=markdown,
            html=html,
            sources=sources or [],
            cache_hit=cache_hit,
        )
    # @classmethod는 데코레이터다. failed()는 JobResult 클래스에서 바로 호출되며,
    # 첫 번째 인자로 클래스(cls)를 받아 실패 결과를 만드는 named constructor 역할을 한다.
    @classmethod
    def failed(cls, *, job_id: str, error: str) -> "JobResult":
        if not error:
            raise ValueError("error is required for failed jobs")
        return cls(job_id=job_id, status="failed", error=error)

    def to_payload(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "status": self.status,
            "cacheHit": self.cache_hit,
            "markdown": self.markdown,
            "html": self.html,
            "sources": self.sources,
            "error": self.error,
        }
