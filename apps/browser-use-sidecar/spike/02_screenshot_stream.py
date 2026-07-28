"""
阶段 0 & 阶段 1 核心引擎 — 包含商业电商商品识别与普通菜单智能过滤

运行方式：
  uv run --directory apps/browser-use-sidecar python spike/02_screenshot_stream.py
"""

import asyncio
import ctypes
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

SW_RESTORE = 9

def bring_window_to_foreground(keyword: str = "Chrome") -> bool:
    if sys.platform != "win32":
        return True
    try:
        user32 = ctypes.windll.user32
        found_hwnd = []
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)

        def enum_windows_callback(hwnd, lparam):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                buff = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buff, length + 1)
                title = buff.value
                if any(k in title for k in [keyword, "Chromium", "小红书", "什么值得买", "验证", "Example"]):
                    found_hwnd.append(hwnd)
            return True

        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
        if found_hwnd:
            hwnd = found_hwnd[0]
            user32.ShowWindow(hwnd, SW_RESTORE)
            user32.SetForegroundWindow(hwnd)
            print(f"  [控制权] 成功将浏览器原生窗口 (HWND: {hwnd}) 切至最前台！")
            return True
        return False
    except Exception as e:
        print(f"  ⚠ 窗口切前台提示: {e}")
        return False


WS_PORT = 8765
TARGET_FPS = 2
IDLE_FPS = 0.5

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
agent_paused = False

def extract_clean_url(text: str) -> str | None:
    match = re.search(r'https?://[a-zA-Z0-9.\-]+(?::\d+)?(?:/[^\s\u4e00-\u9fa5,"\'“”‘’()]*)?', text)
    if match:
        url = match.group(0).rstrip('./,;!')
        return url
    return None

def extract_target_count(text: str) -> int:
    match = re.search(r'(?:前|采集|提取|要|抓取)?\s*(\d+)\s*(?:条|项|个|篇|行|数据|记录)', text)
    if match:
        try:
            num = int(match.group(1))
            if 1 <= num <= 50:
                return num
        except ValueError:
            pass
    return 5


async def handler(ws):
    global pending_nav_url, pending_task_text, agent_paused
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
                        agent_paused = False
                        clean_url = extract_clean_url(text)
                        if clean_url:
                            pending_nav_url = clean_url
                            print(f"  ⚡ 捕获到规范的目标 URL: {pending_nav_url}")
                    elif msg_type == 'control':
                        action = data.get('action')
                        if action == 'takeover':
                            print("  [控制权] 收到手动接管请求，强行切窗口到前台...")
                            bring_window_to_foreground()
                        elif action == 'resume':
                            print("  [控制权] 收到恢复请求，解除 Agent 暂停状态...")
                            agent_paused = False
                        elif action == 'pause':
                            agent_paused = True
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


async def smart_semantic_extract(page, target_url: str, target_count: int = 10) -> list[dict]:
    """
    Browser Use AI 商业级别提取器：
    支持智能过滤顶部/侧边栏普通导航菜单，精准抓取商品标题与详情链接
    """
    extracted_items = []
    seen_titles = set()

    # 常见无意义导航菜单关键词列表 (黑名单过滤)
    NAV_BLACKLIST = {
        "首页", "好价", "社区", "原创", "资讯", "优惠券", "白菜价", "国内好价", "海淘好价",
        "排行榜", "众测", "品牌库", "分类", "登录", "注册", "个人中心", "消息", "APP", "下载",
        "关于我们", "联系我们", "关注", "反馈", "全部", "换一换", "更多", "查看详情"
    }

    # 针对什么值得买等电商站点的精准优先选择器
    if "smzdm.com" in target_url:
        try:
            # 显式等待商品列表渲染
            await page.wait_for_selector("a[href*='/p/'], .feed-block-title, .z-feed-title, h5", timeout=6000)
        except Exception:
            pass

        selectors = [
            "a[href*='/p/']",
            ".feed-block-title a",
            ".z-feed-title a",
            "a.feed-block-title-text",
            "h5 a",
            "h2 a",
            ".feed-title a"
        ]
    elif "cnblogs.com" in target_url:
        selectors = [
            "a.post-item-title",
            ".post-item-title",
            "article a.title",
            "a[href*='cnblogs.com/']"
        ]
    else:
        selectors = [
            ".title span", ".note-item .title", "a.title",
            "h2 a", "h3 a", "h4 a", "h5 a", "article a", ".item a", "li a"
        ]

    for sel in selectors:
        if len(extracted_items) >= target_count:
            break
        try:
            elements = await page.query_selector_all(sel)
            for elem in elements:
                if len(extracted_items) >= target_count:
                    break
                
                # 检查是否为 nav 头部或 footer 尾部普通菜单元素
                is_nav_parent = await elem.evaluate("""
                    el => !!el.closest('nav, header, .nav, .menu, .head-nav, .top-nav, footer, .footer')
                """)
                if is_nav_parent and "smzdm.com" in target_url:
                    continue

                t = (await elem.text_content()).strip()
                t_clean = " ".join(t.split())
                h = await elem.get_attribute("href")

                # 强过滤规则：字数 >= 5，非黑名单文本，非绝对纯 URL
                if (
                    t_clean
                    and len(t_clean) >= 5
                    and t_clean not in NAV_BLACKLIST
                    and t_clean not in seen_titles
                    and not t_clean.startswith("http")
                ):
                    seen_titles.add(t_clean)
                    extracted_items.append({"title": t_clean, "url": h or target_url})
        except Exception:
            continue

    return extracted_items


async def detect_captcha_or_login(page) -> bool:
    try:
        title = await page.title()
        url = page.url
        content = await page.content()

        captcha_keywords = ["验证码", "安全验证", "滑块", "captcha", "geetest", "请完成验证", "登录后查看", "操作过于频繁"]
        if any(k in title.lower() for k in captcha_keywords) or "login" in url:
            return True

        captcha_elems = await page.query_selector_all(".captcha, iframe[src*='captcha'], #slideBlock, .geetest_holder, .login-container")
        if len(captcha_elems) > 0:
            return True

        if "安全验证" in content or "拖动滑块" in content or "操作过于频繁" in content:
            return True

    except Exception:
        pass
    return False


async def screenshot_sender():
    global pending_nav_url, pending_task_text, agent_paused
    await asyncio.sleep(2)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ]
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        page = await context.new_page()
        current_loaded_url = "http://localhost:8080/table.html"
        await page.goto(current_loaded_url)
        print(f"▶ 截图采集端启动，初始加载 {current_loaded_url}")

        try:
            async with websockets.connect(f"ws://localhost:{WS_PORT}") as ws:
                print("✅ 智能商品与文章提取引擎（带普通菜单过滤）就绪...")
                frame_seq = 0
                last_hash = ""

                while True:
                    t_start = time.time()

                    if pending_nav_url and pending_nav_url != current_loaded_url and not agent_paused:
                        target = pending_nav_url
                        pending_nav_url = None
                        print(f"▶ 驱动 Chromium 导航跳转至规范 URL: {target} ...")
                        try:
                            await page.goto(target, wait_until="domcontentloaded", timeout=15000)
                            current_loaded_url = target
                            print(f"✅ 成功导航至: {target}")
                            await broadcast_json({"type": "url_changed", "url": target})

                            await asyncio.sleep(1.5)
                            is_blocked = await detect_captcha_or_login(page)

                            if is_blocked:
                                print(f"⚠️ [反爬告警] 目标站点 ({target}) 触发了验证码/频控！自动切窗口至前台...")
                                agent_paused = True
                                await broadcast_json({
                                    "type": "human_intervention_required",
                                    "reason": "检测到目标站点提示“验证码/操作过于频繁”，已强行将窗口弹出至最前台，请在原生窗口中完成验证。",
                                    "targetUrl": target,
                                })
                                bring_window_to_foreground()
                                continue

                            target_count = extract_target_count(pending_task_text)
                            print(f"🤖 智能解析目标提取数量: {target_count} 条，启动 AI 抽取引擎 (带菜单过滤)...")

                            extracted_items = await smart_semantic_extract(page, target, target_count=target_count)

                            print(f"✅ 成功精准提取到 {len(extracted_items)} 条数据，回传 Chat 框...")
                            await broadcast_json({
                                "type": "task_result",
                                "targetUrl": target,
                                "taskText": pending_task_text,
                                "count": len(extracted_items),
                                "items": extracted_items
                            })

                        except Exception as nav_err:
                            print(f"⚠ 跳转/提取异常: {nav_err}")

                    try:
                        screenshot_bytes = await page.screenshot(
                            type="jpeg",
                            quality=65,
                            animations="disabled",
                        )
                        current_hash = hashlib.md5(screenshot_bytes[:1024]).hexdigest()
                        changed = current_hash != last_hash

                        if changed or frame_seq % 3 == 0:
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
                    except Exception:
                        pass

                    sleep_time = (1.0 / (TARGET_FPS if changed else IDLE_FPS)) - (time.time() - t_start)
                    await asyncio.sleep(max(0.2, sleep_time))

        except Exception as e:
            print(f"❌ 截图发送异常：{e}")
        finally:
            await browser.close()


async def main():
    print(f"▶ 启动 WebSocket 服务端 ws://localhost:{WS_PORT} ...")
    server = await websockets.serve(handler, "localhost", WS_PORT)
    print("✅ 智能商业提取与菜单过滤引擎已运行！")
    await asyncio.gather(server.wait_closed(), screenshot_sender())

if __name__ == "__main__":
    asyncio.run(main())
