from __future__ import annotations

from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator


class StrictMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExecuteRequest(StrictMessage):
    protocol_version: Literal["1.0.0"]
    type: Literal["execute"]
    request_id: str = Field(min_length=1)
    task_id: str = Field(min_length=1)
    cdp_endpoint: str = Field(min_length=1)
    target_id: str = Field(min_length=1)
    prompt: str = Field(min_length=1, max_length=100_000)
    allowed_domains: list[str] = Field(min_length=1, max_length=100)
    max_steps: int = Field(default=100, ge=1, le=500)

    @field_validator("cdp_endpoint")
    @classmethod
    def require_loopback_cdp(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "ws"}:
            raise ValueError("CDP endpoint must use http or ws")
        if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("CDP endpoint must be loopback-only")
        if parsed.port is None:
            raise ValueError("CDP endpoint must include an explicit port")
        return value

    @field_validator("allowed_domains")
    @classmethod
    def normalize_domains(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            candidate = value if "://" in value else f"https://{value}"
            hostname = urlparse(candidate).hostname
            if not hostname:
                raise ValueError(f"Invalid allowed domain: {value}")
            normalized.append(hostname.lower())
        return sorted(set(normalized))


class ControlRequest(StrictMessage):
    protocol_version: Literal["1.0.0"]
    type: Literal["pause", "resume", "cancel"]
    request_id: str = Field(min_length=1)
    task_id: str = Field(min_length=1)


class PingRequest(StrictMessage):
    protocol_version: Literal["1.0.0"]
    type: Literal["ping"]
    request_id: str = Field(min_length=1)


class ShutdownRequest(StrictMessage):
    protocol_version: Literal["1.0.0"]
    type: Literal["shutdown"]
    request_id: str = Field(min_length=1)


WorkerRequest = Annotated[
    ExecuteRequest | ControlRequest | PingRequest | ShutdownRequest,
    Field(discriminator="type"),
]
WORKER_REQUEST_ADAPTER = TypeAdapter(WorkerRequest)


def parse_request(payload: str) -> WorkerRequest:
    return WORKER_REQUEST_ADAPTER.validate_json(payload)


class WorkerResponse(StrictMessage):
    protocol_version: Literal["1.0.0"] = "1.0.0"
    type: Literal["ready", "ack", "result", "error"]
    request_id: str | None = None
    task_id: str | None = None
    status: str | None = None
    payload: dict[str, object] = Field(default_factory=dict)
