"""
阶段 0 & 阶段 1 核心引擎 — 支持真实网页导航、异步元素等待、数据去重与 5 条满额提取

运行方式：
  uv run --directory apps/browser-use-sidecar python spike/02_screenshot_stream.py
"""

import asyncio
import hashlib
import json
import re
import struct
import sys
import time
from pathlib import Path
import websockets
from playwright.async_api import async_playwright

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

WS_PORT = 8765
TARGET_FPS = 5
IDLE_FPS = 1

def encode_frame(
    task_id: str,
    frame_seq: int,
    captured_at: float,
    width: int,
    height: int,
    image_bytes: bytes,
    redacted: bool = False,
) -> bytes:
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
pending_nav_url = None
pending_task_text = ""

async def handler(ws):
    global pending_nav_url, pending_task_text
    clients.add(ws)
    try:
        async for message in ws:
            if isinstance(message, bytes):
                observer_count = len(clients) - 1
                if observer_count > 0:
                    tasks = [c.send(message) for c in clients if c != ws]
                    await asyncio.gather(*tasks, return_exceptions=True)
            elif isinstance(message, str):
                try:
                    data = json.loads(message)
                    msg_type = data.get('type')
                    if msg_type == 'task':
                        text = data.get('text', '')
                        print(f"  [WS 服务端] 收到任务指令: {text}")
                        pending_task_text = text
                        match = re.search(r'https?://[^\s]+', text)
                        if match:
                            pending_nav_url = match.group(0)
                            print(f"  ⚡ 捕获到目标 URL 跳转请求: {pending_nav_url}")
                except Exception:
                    pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        clients.discard(ws)


async def broadcast_json(msg: dict):
    if not clients:
        return
    raw = json.dumps(msg, ensure_ascii=False)
    tasks = [c.send(raw) for c in clients]
    await asyncio.gather(*tasks, return_exceptions=True)


async def screenshot_sender():
    global pending_nav_url, pending_task_text
    await asyncio.sleep(2)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        current_loaded_url = "http://localhost:8080/table.html"
        await page.goto(current_loaded_url)
        print(f"▶ 截图采集端启动，初始加载 {current_loaded_url}")

        try:
            async with websockets.connect(f"ws://localhost:{WS_PORT}") as ws:
                print("✅ 截图采集端连接 WS 成功，持续推流与智能提取中...")
                frame_seq = 0
                last_hash = ""

                while True:
                    t_start = time.time()

                    if pending_nav_url and pending_nav_url != current_loaded_url:
                        target = pending_nav_url
                        pending_nav_url = None
                        print(f"▶ 驱动 Chromium 导航跳转至: {target} ...")
                        try:
                            await page.goto(target, wait_until="networkidle")
                            current_loaded_url = target
                            print(f"✅ 成功导航至: {target}")

                            await broadcast_json({"type": "url_changed", "url": target})

                            extracted_items = []
                            seen_titles = set()

                            if "cnblogs.com" in target:
                                # 等待文章卡片渲染就绪
                                try:
                                    await page.wait_for_selector(".post-item, article, a.post-item-title", timeout=5000)
                                except Exception:
                                    pass

                                # 提取文章选择器组合
                                selectors = [
                                    "a.post-item-title",
                                    ".post-item-title",
                                    "article a.title",
                                    "a[href*='cnblogs.com/']"
                                ]

                                for sel in selectors:
                                    if len(extracted_items) >= 5:
                                        break
                                    elements = await page.query_selector_all(sel)
                                    for elem in elements:
                                        if len(extracted_items) >= 5:
                                            break
                                        title = (await elem.text_content()).strip()
                                        href = await elem.get_attribute("href")
                                        # 去除无效或太短的标题（如按钮文本、分类名称）
                                        if title and len(title) > 4 and title not in seen_titles and not title.startswith("http"):
                                            seen_titles.add(title)
                                            extracted_items.append({"title": title, "url": href or target})
                            else:
                                rows = await page.query_selector_all("tr, li, .item")
                                for r in rows[1:6] if len(rows) > 1 else rows[:5]:
                                    txt = (await r.text_content()).strip()
                                    txt_clean = " ".join(txt.split())
                                    if txt_clean and txt_clean not in seen_titles:
                                        seen_titles.add(txt_clean)
                                        extracted_items.append({"title": txt_clean, "url": target})

                            print(f"✅ 成功精准提取到 {len(extracted_items)} 条数据，准备回传 Chat 聊天框...")
                            await broadcast_json({
                                "type": "task_result",
                                "targetUrl": target,
                                "taskText": pending_task_text,
                                "count": len(extracted_items),
                                "items": extracted_items
                            })

                        except Exception as nav_err:
                            print(f"⚠ 跳转/提取产生异常: {nav_err}")

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
