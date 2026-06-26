"""Sageum-specific worker surface.

This package contains the full retained runtime for the Sageum curriculum
worker: job contracts, web collection, Codex OAuth calls, rendering, and the
HTTP worker entrypoint.
"""

from .contracts import JobRequest, JobResult

__all__ = ["JobRequest", "JobResult"]
