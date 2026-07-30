from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from .protocol import (
    ControlRequest,
    ExecuteRequest,
    PingRequest,
    ShutdownRequest,
    WorkerResponse,
    parse_request,
)


@dataclass
class ActiveExecution:
    request: ExecuteRequest
    task: asyncio.Task[None]
    idle: asyncio.Event
    agent: Any | None = None


class SidecarWorker:
    def __init__(self) -> None:
        self._active: ActiveExecution | None = None
        self._write_lock = asyncio.Lock()
        self._stopping = False

    async def run(self) -> None:
        await self._emit(WorkerResponse(type="ready", status="ready"))
        loop = asyncio.get_running_loop()
        while not self._stopping:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            await self._handle_line(line)
        if self._active:
            await self._cancel_active()

    async def _handle_line(self, line: str) -> None:
        try:
            request = parse_request(line)
            if isinstance(request, ExecuteRequest):
                await self._start_execution(request)
            elif isinstance(request, ControlRequest):
                await self._control(request)
            elif isinstance(request, PingRequest):
                await self._emit(
                    WorkerResponse(type="ack", request_id=request.request_id, status="alive")
                )
            elif isinstance(request, ShutdownRequest):
                self._stopping = True
                await self._cancel_active()
                await self._emit(
                    WorkerResponse(type="ack", request_id=request.request_id, status="stopping")
                )
        except ValidationError as error:
            await self._emit(
                WorkerResponse(
                    type="error",
                    status="invalid_request",
                    payload={"detail": str(error)},
                )
            )
        except Exception as error:  # keep protocol errors on stdout, diagnostics on stderr
            print(f"sidecar request failure: {error}", file=sys.stderr, flush=True)
            await self._emit(
                WorkerResponse(
                    type="error",
                    status="request_failed",
                    payload={"detail": str(error)},
                )
            )

    async def _start_execution(self, request: ExecuteRequest) -> None:
        if self._active:
            raise RuntimeError(f"Sidecar is already executing task {self._active.request.task_id}")
        idle = asyncio.Event()
        idle.set()
        task = asyncio.create_task(self._execute(request), name=f"sidecar:{request.task_id}")
        self._active = ActiveExecution(request=request, task=task, idle=idle)
        await self._emit(
            WorkerResponse(
                type="ack",
                request_id=request.request_id,
                task_id=request.task_id,
                status="accepted",
            )
        )

    async def _execute(self, request: ExecuteRequest) -> None:
        browser = None
        try:
            api_key = os.environ.get("BROWSER_USE_API_KEY") or os.environ.get("OPENAI_API_KEY")
            if not api_key:
                raise RuntimeError("BROWSER_USE_API_KEY or OPENAI_API_KEY is required")

            from browser_use import Agent, BrowserSession, ChatOpenAI

            browser = BrowserSession(
                cdp_url=request.cdp_endpoint,
                allowed_domains=request.allowed_domains,
                keep_alive=True,
            )
            await browser.start()
            if browser.session_manager is None:
                raise RuntimeError("Browser Use session manager did not initialize")
            target = browser.session_manager.get_target(request.target_id)
            if target is None:
                raise RuntimeError("Desktop task target is not available to Sidecar")
            browser.agent_focus_target_id = request.target_id

            llm = ChatOpenAI(
                model=os.environ.get("BROWSER_USE_MODEL", "gpt-4.1-mini"),
                api_key=api_key,
                base_url=os.environ.get("BROWSER_USE_BASE_URL"),
                temperature=0,
            )
            guarded_prompt = (
                f"{request.prompt}\n\n"
                "Hard constraints: operate only in the existing Desktop-selected tab; "
                f"allowed domains are {', '.join(request.allowed_domains)}; "
                "do not submit, confirm, pay, send, upload, or perform any write/commit action. "
                "Stop and report that human approval is required before any such action."
            )
            agent = Agent(
                task=guarded_prompt,
                llm=llm,
                browser=browser,
                task_id=request.task_id,
                directly_open_url=False,
                enable_signal_handler=False,
            )
            if self._active and self._active.request.task_id == request.task_id:
                self._active.agent = agent
            async def on_step_start(_: Any) -> None:
                if self._active and self._active.request.task_id == request.task_id:
                    self._active.idle.clear()

            async def on_step_end(_: Any) -> None:
                if self._active and self._active.request.task_id == request.task_id:
                    self._active.idle.set()

            history = await agent.run(
                max_steps=request.max_steps,
                on_step_start=on_step_start,
                on_step_end=on_step_end,
            )
            await self._emit(
                WorkerResponse(
                    type="result",
                    request_id=request.request_id,
                    task_id=request.task_id,
                    status="succeeded",
                    payload={"final_result": history.final_result() or ""},
                )
            )
        except asyncio.CancelledError:
            await self._emit(
                WorkerResponse(
                    type="result",
                    request_id=request.request_id,
                    task_id=request.task_id,
                    status="cancelled",
                )
            )
            raise
        except Exception as error:
            print(f"sidecar execution failure: {error}", file=sys.stderr, flush=True)
            await self._emit(
                WorkerResponse(
                    type="result",
                    request_id=request.request_id,
                    task_id=request.task_id,
                    status="failed",
                    payload={"error": str(error)},
                )
            )
        finally:
            if self._active and self._active.request.task_id == request.task_id:
                self._active.idle.set()
            if browser is not None:
                await browser.stop()
            if self._active and self._active.request.task_id == request.task_id:
                self._active = None

    async def _control(self, request: ControlRequest) -> None:
        if not self._active or self._active.request.task_id != request.task_id:
            raise RuntimeError(f"Task is not active in Sidecar: {request.task_id}")
        agent = self._active.agent
        if request.type == "pause":
            if agent is not None:
                agent.pause()
            await asyncio.wait_for(self._active.idle.wait(), timeout=30)
        elif request.type == "resume":
            if agent is not None:
                agent.resume()
        else:
            await self._cancel_active()
        await self._emit(
            WorkerResponse(
                type="ack",
                request_id=request.request_id,
                task_id=request.task_id,
                status=request.type,
            )
        )

    async def _cancel_active(self) -> None:
        active = self._active
        if not active:
            return
        if active.agent is not None:
            active.agent.stop()
        active.task.cancel()
        try:
            await active.task
        except asyncio.CancelledError:
            pass
        self._active = None

    async def _emit(self, response: WorkerResponse) -> None:
        line = response.model_dump_json(exclude_none=True)
        async with self._write_lock:
            sys.stdout.write(f"{line}\n")
            sys.stdout.flush()


def main() -> None:
    os.environ.setdefault("BROWSER_USE_SETUP_LOGGING", "false")
    asyncio.run(SidecarWorker().run())


if __name__ == "__main__":
    main()
