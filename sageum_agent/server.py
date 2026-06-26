from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse

from .codex_client import codex_auth_status
from .contracts import JobRequest, JobResult
from .curriculum import generate_curriculum
from .settings import load_settings


logger = logging.getLogger(__name__)
app = FastAPI(title="Sageum Agent", version="0.1.0")
_active_tasks: dict[str, asyncio.Task] = {}


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "activeJobs": len(_active_tasks),
        "codex": codex_auth_status(),
    }


@app.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
async def create_job(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
        job = JobRequest.from_payload(payload)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if job.job_id in _active_tasks and not _active_tasks[job.job_id].done():
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={"jobId": job.job_id, "status": "already_running"},
        )

    task = asyncio.create_task(_run_job(job))
    _active_tasks[job.job_id] = task
    task.add_done_callback(lambda _: _active_tasks.pop(job.job_id, None))
    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={"jobId": job.job_id, "status": "accepted"},
    )


async def _run_job(job: JobRequest) -> None:
    try:
        generated = await generate_curriculum(job.topic)
        result = JobResult.completed(
            job_id=job.job_id,
            markdown=generated["markdown"],
            html=generated["html"],
            sources=generated.get("sources", []),
            cache_hit=False,
        )
    except Exception as exc:
        logger.exception("Sageum job failed: %s", job.job_id)
        result = JobResult.failed(job_id=job.job_id, error=str(exc))

    if not job.callback_url:
        logger.info("Sageum job %s finished without callbackUrl", job.job_id)
        return

    settings = load_settings()
    async with httpx.AsyncClient(timeout=settings.callback_timeout_seconds) as client:
        response = await client.post(job.callback_url, json=result.to_payload())
    if response.status_code >= 400:
        logger.warning(
            "Sageum callback failed for %s: HTTP %s",
            job.job_id,
            response.status_code,
        )
