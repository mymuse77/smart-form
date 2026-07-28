"""
阶段 0 Spike 脚本 — 截图流 WebSocket 验证

验证内容：
1. Node.js 风格的截图采集（用 Playwright Python 模拟）
2. WebSocket 二进制帧转发
3. 自适应帧率（页面无变化时降频）

运行方式（需要 3 个终端）：
  终端 1：uv run python spike/02_screenshot_ws_server.py  (启动 WS 服务端)
  终端 2：uv run python spike/02_screenshot_sender.py      (启动截图发送端)
  终端 3：打开 spike/02_screenshot_viewer.html             (浏览器查看)
"""

import asyncio
import hashlib
import json
import struct
import time
from pathlib import Path
import websockets
from playwright.async_api import async_playwright


WS_PORT = 8765
TARGET_FPS = 5          # 最高帧率
IDLE_FPS = 1            # 无变化时降频
CHANGE_THRESHOLD = 0.02 # 变化率阈值（2%）


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


async def screenshot_sender():
    """截图采集端：连接可见 Chromium，持续采集并通过 WS 发送帧"""

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        await page.goto("https://example.com")

        print(f"▶ 截图采集端启动，连接 WS ws://localhost:{WS_PORT}")

        try:
            async with websockets.connect(f"ws://localhost:{WS_PORT}") as ws:
                print("✅ WS 连接成功，开始采集截图流...")

                frame_seq = 0
                last_hash = ""
                interval = 1.0 / TARGET_FPS

                # 导航到几个页面测试动态帧率
                test_urls = [
                    "https://example.com",
                    "https://httpbin.org/html",
                    "https://example.com",
                ]
                url_idx = 0
                next_nav = time.time() + 5.0

                while frame_seq < 50:  # 采集 50 帧后结束
                    t_start = time.time()

                    # 每 5 秒切换页面
                    if time.time() >= next_nav and url_idx < len(test_urls) - 1:
                        url_idx += 1
                        await page.goto(test_urls[url_idx])
                        next_nav = time.time() + 5.0
                        print(f"▶ 切换到: {test_urls[url_idx]}")

                    # 截图（WebP 格式，80% 质量）
                    screenshot_bytes = await page.screenshot(
                        type="jpeg",
                        quality=80,
                        full_page=False,
                    )

                    # 计算变化哈希
                    current_hash = hashlib.md5(screenshot_bytes[:1024]).hexdigest()
                    changed = current_hash != last_hash

                    if changed or frame_seq % 5 == 0:  # 变化时或每 5 帧强制发一帧
                        frame_data = encode_frame(
                            task_id="spike-task-001",
                            frame_seq=frame_seq,
                            captured_at=time.time(),
                            width=1280,
                            height=720,
                            image_bytes=screenshot_bytes,
                        )
                        await ws.send(frame_data)
                        print(f"  帧 #{frame_seq:04d} 已发送 ({len(screenshot_bytes) // 1024}KB)"
                              f"{'[变化]' if changed else '[强制]'}")
                        last_hash = current_hash
                    else:
                        print(f"  帧 #{frame_seq:04d} 跳过（无变化）")

                    frame_seq += 1

                    # 自适应帧率
                    sleep_time = (1.0 / (TARGET_FPS if changed else IDLE_FPS)) - (time.time() - t_start)
                    if sleep_time > 0:
                        await asyncio.sleep(sleep_time)

                print("✅ 截图发送完成（50帧）")

        except Exception as e:
            print(f"❌ WS 发送失败：{e}")
        finally:
            await browser.close()


async def screenshot_ws_server():
    """WebSocket 服务端：接收截图帧并广播给所有观察者"""

    clients = set()

    async def handler(ws):
        clients.add(ws)
        client_type = "unknown"
        try:
            async for message in ws:
                if isinstance(message, bytes):
                    # 二进制帧：来自截图采集端，广播给其他 clients
                    client_type = "sender"
                    observer_count = len(clients) - 1
                    if observer_count > 0:
                        # 广播给所有非发送者
                        tasks = [
                            c.send(message)
                            for c in clients
                            if c != ws
                        ]
                        await asyncio.gather(*tasks, return_exceptions=True)
                        print(f"  转发帧给 {observer_count} 个观察者 ({len(message)//1024}KB)")
                elif isinstance(message, str):
                    # 文本消息：来自观察者浏览器
                    client_type = "observer"
                    data = json.loads(message)
                    print(f"  观察者消息：{data.get('type', 'unknown')}")
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            clients.discard(ws)
            print(f"  客户端断开（{client_type}），剩余 {len(clients)} 个连接")

    print(f"▶ WebSocket 服务端启动 ws://localhost:{WS_PORT}")
    async with websockets.serve(handler, "localhost", WS_PORT):
        await asyncio.Future()  # 持续运行


if __name__ == "__main__":
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "server"

    if mode == "server":
        asyncio.run(screenshot_ws_server())
    elif mode == "sender":
        asyncio.run(screenshot_sender())
    else:
        print("用法: python 02_screenshot_stream.py [server|sender]")
