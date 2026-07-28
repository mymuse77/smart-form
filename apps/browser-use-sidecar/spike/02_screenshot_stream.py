"""
阶段 0 Spike 脚本 — 截图流 WebSocket 整合端 (同时支持指令解析与自动导航)

运行方式：
  uv run --directory apps/browser-use-sidecar python spike/02_screenshot_stream.py
"""

import asyncio
import hashlib
import json
import re
import struct
import time
from pathlib import Path
import websockets
from playwright.async_api import async_playwright

WS_PORT = 8765
TARGET_FPS = 5          # 最高帧率
IDLE_FPS = 1            # 无变化时降频

def encode_frame(
    task_id: str,
    frame_seq: int,
    captured_at: float,
    width: int,
    height: int,
    image_bytes: bytes,
    redacted: bool = False,
) -> bytes:
    """
    编码截图帧为二进制格式：
    [4B magic] [1B version] [1B flags] [4B seq] [8B timestamp_ms]
    [2B width] [2B height] [4B task_id_len] [task_id] [4B image_len] [image]
    """
    MAGIC = b"SMFR"
    VERSION = 1
    flags = 0x01 if redacted else 0x00

    task_id_bytes = task_id.encode("utf-8")
    header = struct.pack(
        f">4sBBIQHHI{len(task_id_bytes)}sI",
        MAGIC,
        VERSION,
        flags,
        frame_seq,
        int(captured_at * 1000),
        width,
        height,
        len(task_id_bytes),
        task_id_bytes,
        len(image_bytes),
    )
    return header + image_bytes


clients = set()
pending_nav_url = None  # 待跳转 URL 队列

async def handler(ws):
    global pending_nav_url
    clients.add(ws)
    client_type = "unknown"
    try:
        async for message in ws:
            if isinstance(message, bytes):
                client_type = "sender"
                observer_count = len(clients) - 1
                if observer_count > 0:
                    tasks = [c.send(message) for c in clients if c != ws]
                    await asyncio.gather(*tasks, return_exceptions=True)
            elif isinstance(message, str):
                client_type = "observer"
                try:
                    data = json.loads(message)
                    text = data.get('text', '')
                    print(f"  [WS 服务端] 收到观察者指令: {data.get('type')} ({text})")

                    # 解析文本中的 URL 链接
                    match = re.search(r'https?://[^\s]+', text)
                    if match:
                        pending_nav_url = match.group(0)
                        print(f"  ⚡ 捕获到目标 URL 跳转请求: {pending_nav_url}")
                except Exception as e:
                    pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        clients.discard(ws)


async def screenshot_sender():
    global pending_nav_url
    await asyncio.sleep(2)  # 等待 WS 服务端准备就绪
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        current_loaded_url = "http://localhost:8080/table.html"
        await page.goto(current_loaded_url)
        print(f"▶ 截图采集端启动，已初始加载 {current_loaded_url}")

        try:
            async with websockets.connect(f"ws://localhost:{WS_PORT}") as ws:
                print("✅ 截图采集端连接 WS 成功，持续推流与指令监听中...")
                frame_seq = 0
                last_hash = ""

                while True:
                    t_start = time.time()

                    # 检查是否有来自 WS 的新 URL 跳转请求
                    if pending_nav_url and pending_nav_url != current_loaded_url:
                        target = pending_nav_url
                        pending_nav_url = None
                        print(f"▶ 正在驱动 Chromium 跳转至: {target} ...")
                        try:
                            await page.goto(target, wait_until="domcontentloaded")
                            current_loaded_url = target
                            print(f"✅ 成功跳转至: {target}")
                        except Exception as nav_err:
                            print(f"⚠ 跳转产生异常: {nav_err}")

                    screenshot_bytes = await page.screenshot(type="jpeg", quality=75)
                    current_hash = hashlib.md5(screenshot_bytes[:1024]).hexdigest()
                    changed = current_hash != last_hash

                    frame_data = encode_frame(
                        task_id="spike-task-001",
                        frame_seq=frame_seq,
                        captured_at=time.time(),
                        width=1280,
                        height=720,
                        image_bytes=screenshot_bytes,
                    )
                    await ws.send(frame_data)
                    last_hash = current_hash
                    frame_seq += 1

                    sleep_time = (1.0 / (TARGET_FPS if changed else IDLE_FPS)) - (time.time() - t_start)
                    await asyncio.sleep(max(0.1, sleep_time))

        except Exception as e:
            print(f"❌ 截图发送异常：{e}")
        finally:
            await browser.close()


async def main():
    print(f"▶ 启动 WebSocket 服务端 ws://localhost:{WS_PORT} ...")
    server = await websockets.serve(handler, "localhost", WS_PORT)
    print("✅ WebSocket 服务端运行中！拉起 Chromium 画面采集器...")
    await asyncio.gather(server.wait_closed(), screenshot_sender())

if __name__ == "__main__":
    asyncio.run(main())
