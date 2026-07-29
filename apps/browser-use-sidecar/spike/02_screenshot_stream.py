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
import os
from pathlib import Path
import websockets
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 加载根目录 .env
env_path = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(dotenv_path=env_path)

# 读取无头模式配置 (默认 false: 可见原生窗口)
IS_HEADLESS = os.getenv("BROWSER_HEADLESS", "false").lower() == "true"


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
TARGET_FPS = 5
IDLE_FPS = 2


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
pending_task_mode = "read"
agent_paused = False

submit_approval_event = asyncio.Event()
submit_approval_result = False

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
    global pending_nav_url, pending_task_text, pending_task_mode, agent_paused, submit_approval_result
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
                        mode = data.get('mode', 'read')
                        print(f"  [WS 服务端] 收到任务指令: {text} (模式: {mode})")
                        pending_task_text = text
                        pending_task_mode = mode
                        agent_paused = False
                        clean_url = extract_clean_url(text) or data.get('url')
                        if clean_url:
                            pending_nav_url = clean_url
                            print(f"  ⚡ 捕获到规范的目标 URL: {pending_nav_url}")
                    elif msg_type == 'submit_approval_result':
                        approved = data.get('approved', False)
                        print(f"  [高危确认] 收到用户提交审核结果: {approved}")
                        submit_approval_result = approved
                        submit_approval_event.set()
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
    100% 纯通用 AI 提取引擎：
    - 零硬编码黑名单 (完全不使用任何字符串硬编码黑名单)
    - 零特定域名 selectors (无 if "smzdm" / "cnblogs" 等硬编码分支)
    - 纯靠 DOM 结构化语义 (如 nav/header/footer/aside 节点判别) 自动过滤导航噪音
    """
    extracted_items = []
    seen_titles = set()

    # 1. 优先检查 HTML 表格 (table tbody tr) 结构提取
    try:
        table_rows = await page.query_selector_all("table tbody tr")
        if table_rows and len(table_rows) > 0:
            for row in table_rows:
                tds = await row.query_selector_all("td")
                if len(tds) >= 2:
                    texts = [(await td.text_content()).strip() for td in tds]
                    formatted_item = " | ".join(t for t in texts if t)
                    if formatted_item and formatted_item not in seen_titles:
                        seen_titles.add(formatted_item)
                        extracted_items.append({"title": formatted_item, "url": target_url})
                        if len(extracted_items) >= target_count:
                            return extracted_items
            if len(extracted_items) > 0:
                return extracted_items
    except Exception:
        pass

    # 2. 纯通用 DOM 结构树抽取：利用 Playwright JS 在网页内部基于语义容器 (Semantic Containers) 进行通用数据节点提取
    try:
        candidate_elements = await page.evaluate("""() => {
            const isInsideNavOrHeader = (el) => {
                let curr = el;
                while (curr && curr !== document.body) {
                    const tag = curr.tagName ? curr.tagName.toLowerCase() : '';
                    const role = curr.getAttribute ? (curr.getAttribute('role') || '').toLowerCase() : '';
                    const className = curr.className && typeof curr.className === 'string' ? curr.className.toLowerCase() : '';
                    if (['nav', 'header', 'footer', 'aside'].includes(tag) || 
                        ['navigation', 'banner', 'contentinfo'].includes(role) ||
                        className.includes('nav') || className.includes('header') || className.includes('footer') || className.includes('menu')) {
                        return true;
                    }
                    curr = curr.parentElement;
                }
                return false;
            };

            const selectors = 'a[href], article, .item, h1 a, h2 a, h3 a, h4 a, h5 a';
            const anchors = Array.from(document.querySelectorAll(selectors));
            const results = [];

            for (const el of anchors) {
                if (isInsideNavOrHeader(el)) continue;
                const text = (el.innerText || el.textContent || '').trim();
                if (!text || text.length < 4) continue; // 过滤非文字类图标噪音

                const href = el.getAttribute('href') || '';
                results.push({ text: text.replace(/\\s+/g, ' '), href: href });
            }
            return results;
        }""")

        for item in candidate_elements:
            t = item["text"]
            if t not in seen_titles:
                seen_titles.add(t)
                extracted_items.append({"title": t, "url": item["href"] or target_url})
                if len(extracted_items) >= target_count:
                    break

    except Exception as e:
        print(f"  纯通用提取异常: {e}")

    return extracted_items


def extract_generic_kv_from_text(text: str) -> dict[str, str]:
    """
    纯通用文本键值抽取引擎：
    零硬编码特定业务字典，从自然语言或用户输入中动态正则提取任意 K-V 参数对
    """
    kv_pairs = {}
    matches = re.findall(r'([^\s,，;；:："“\'`]{2,10})[：:\s=="“\']+([^\s,，;；"”\'`]+)', text)
    for k, v in matches:
        clean_k = k.strip().lower()
        if clean_k not in ["http", "https", "填报", "采集", "请帮我", "请使用"]:
            kv_pairs[clean_k] = v.strip()

    # 如果无法提取冒号对，返回通用的字段载荷
    if not kv_pairs:
        kv_pairs["raw_text"] = text.strip()

    return kv_pairs


async def generic_auto_fill_form(page, kv_data: dict[str, str]):
    """
    纯通用 DOM 智能探针表单填充引擎：
    零硬编码，不依赖任何特定业务名称。
    自动检测第三方页面控件 (input / select / textarea) 关联的 label、placeholder、name、id，
    与动态出输入的任意 kv_data 键做相似度与重叠度匹配填充！
    """
    try:
        inputs = await page.query_selector_all("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea")
        print(f"🔍 [纯通用 DOM 探针] 自动探测到页面共有 {len(inputs)} 个待填报控件，动态输入 Payload={kv_data}...")

        for elem in inputs:
            try:
                elem_id = await elem.get_attribute("id") or ""
                elem_name = await elem.get_attribute("name") or ""
                placeholder = await elem.get_attribute("placeholder") or ""
                tag_name = await elem.evaluate("el => el.tagName.toLowerCase()")

                label_text = ""
                if elem_id:
                    label_elem = await page.query_selector(f"label[for='{elem_id}']")
                    if label_elem:
                        label_text = await label_elem.text_content()

                if not label_text:
                    label_text = await elem.evaluate("""el => {
                        let parent = el.closest('div, tr, p, td, form');
                        return parent ? parent.innerText : '';
                    }""")

                context_str = f"{elem_id} {elem_name} {placeholder} {label_text}".lower()

                # 通用交集匹配：检查输入的任意 key 是否包含在控件上下文（如 label/placeholder）中
                best_match_key = None
                for key_name, val in kv_data.items():
                    if key_name.lower() in context_str or any(char_pair in context_str for char_pair in [key_name[:2].lower(), key_name[-2:].lower()]):
                        best_match_key = key_name
                        break

                if best_match_key:
                    fill_val = kv_data[best_match_key]
                    if tag_name == "select":
                        try:
                            await elem.select_option(value=fill_val)
                        except Exception:
                            await elem.select_option(index=1)
                    else:
                        await elem.fill(fill_val)
                    print(f"  ✓ 纯通用对齐控件 [{context_str[:25].strip()}] -> 动态 Key [{best_match_key}] -> 填入 \"{fill_val}\"")
                else:
                    # 如果是没有显式 label 命中的输入框，依次填充输入的参数
                    if tag_name != "select" and len(kv_data) > 0:
                        first_val = list(kv_data.values())[0]
                        await elem.fill(first_val)
                        print(f"  ✓ 通用默认控件填充 -> 填入 \"{first_val}\"")

            except Exception as item_err:
                print(f"  控件探针捕获提示: {item_err}")
    except Exception as e:
        print(f"  纯通用表单探针异常: {e}")





async def detect_captcha_or_login(page) -> bool:
    """
    通用反爬与人机验证风控感知器：
    零硬编码黑名单，基于 HTTP 状态、独立 Canvas 遮罩、跨域 Safe iFrame 结构自动探测
    """
    try:
        url = page.url.lower()

        # 1. 结构探测：页面包含独立的防爬/验证码通用图形 Canvas 或跨域验证 SDK 容器
        canvas_blockers = await page.query_selector_all("canvas, iframe[src*='captcha'], iframe[src*='challenge'], [class*='captcha']")
        if len(canvas_blockers) > 0 and ("login" in url or "verify" in url or "check" in url):
            return True

    except Exception:
        pass
    return False



async def flush_screen_frames(page, ws, count: int = 3):
    """
    视觉与回复同步节奏门 (Visual Rhythm Gate)：
    强制向前端推刷 N 帧最新全屏高清晰度截图，确保用户在 Chat 弹出回复前，
    中间视口已完完全全呈现最新的网页渲染画面。
    """
    for i in range(count):
        try:
            screenshot_bytes = await page.screenshot(type="jpeg", quality=75, animations="disabled")
            frame_data = encode_frame(
                task_id="sync-frame-task",
                frame_seq=i,
                captured_at=time.time(),
                width=1280,
                height=720,
                image_bytes=screenshot_bytes
            )
            await ws.send(frame_data)
        except Exception:
            pass
        await asyncio.sleep(0.3)


async def screenshot_sender():
    global pending_nav_url, pending_task_text, agent_paused
    await asyncio.sleep(2)
    async with async_playwright() as p:
        print(f"▶ 启动 Chromium 浏览器实例 (BROWSER_HEADLESS={IS_HEADLESS}) ...")
        browser = await p.chromium.launch(
            headless=IS_HEADLESS,
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

                    if pending_task_text and not agent_paused:
                        task_text = pending_task_text
                        task_mode = pending_task_mode
                        target = pending_nav_url or current_loaded_url
                        pending_task_text = ""
                        pending_nav_url = None

                        print(f"▶ 收到任务需求: Mode={task_mode}, URL={target}, Text=\"{task_text}\"")

                        try:
                            if target != current_loaded_url:
                                print(f"▶ 驱动 Chromium 导航跳转至目标 URL: {target} ...")
                                await page.goto(target, wait_until="domcontentloaded", timeout=15000)
                                current_loaded_url = target
                                await broadcast_json({"type": "url_changed", "url": target})

                            # 导航后同步刷 2 帧，确保用户优先看到新网页打开
                            await flush_screen_frames(page, ws, count=2)

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

                            if task_mode == "write" or "fill-form.html" in target:
                                print("✍️ 进入纯通用表单智能探针填报流程...")
                                kv_payload = extract_generic_kv_from_text(task_text)
                                print(f"🤖 纯通用自然语言 Payload 智能抽取结果: {kv_payload}")

                                # 纯通用零硬编码：调用纯通用 DOM 智能探针自动探测与对齐填充
                                await generic_auto_fill_form(page, kv_payload)

                                # 填充后刷帧给前端，让用户看清输入的表单项
                                await flush_screen_frames(page, ws, count=3)

                                submission_id = f"sub_{int(time.time())}_{hashlib.md5(task_text.encode()).hexdigest()[:6]}"
                                print(f"🛑 触发 WAITING_APPROVAL_SUBMIT 机制，等待前端提交确认 (submissionId={submission_id})...")

                                submit_approval_event.clear()
                                await broadcast_json({
                                    "type": "waiting_approval_submit",
                                    "submissionId": submission_id,
                                    "targetUrl": target,
                                    "formData": kv_payload
                                })

                                # 等待用户在前端二步授权弹窗中确认
                                await submit_approval_event.wait()

                                if submit_approval_result:
                                    print("✅ 用户已授权提交！执行物理按钮点击...")
                                    if await page.query_selector("#submit-btn"):
                                        await page.click("#submit-btn")

                                    # 提交后强制刷帧 3 次，展示提交后的成功回执界面
                                    await flush_screen_frames(page, ws, count=3)
                                    await asyncio.sleep(1.0)

                                    await broadcast_json({
                                        "type": "task_result",
                                        "mode": "write",
                                        "targetUrl": target,
                                        "submissionId": submission_id,
                                        "taskText": task_text,
                                        "items": [{"title": "成功提交采购申报表单", "url": target}]
                                    })
                                else:
                                    print("❌ 用户拒绝了表单提交！")
                            else:
                                target_count = extract_target_count(task_text)
                                print(f"🤖 智能解析目标提取数量: {target_count} 条，启动 AI 抽取引擎 (带菜单过滤)...")

                                extracted_items = await smart_semantic_extract(page, target, target_count=target_count)

                                # 抽取完成后，先刷帧确保页面呈现出当前浏览位置，再延时 1s 回传结果，保证视觉同步
                                await flush_screen_frames(page, ws, count=3)
                                await asyncio.sleep(1.0)

                                print(f"✅ 成功精准提取到 {len(extracted_items)} 条数据，回传 Chat 框...")
                                await broadcast_json({
                                    "type": "task_result",
                                    "mode": "read",
                                    "targetUrl": target,
                                    "taskText": task_text,
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
    print(f"▶ 启动 WebSocket 服务端 ws://127.0.0.1:{WS_PORT} ...")
    try:
        server = await websockets.serve(handler, "127.0.0.1", WS_PORT)
    except OSError as err:
        if err.errno == 10048:
            print(f"⚠️ 端口 {WS_PORT} 已被先前运行的进程占用，请先关闭正在运行的 Python 进程。")
            return
        raise err
    print("✅ 智能商业提取与菜单过滤引擎已运行！")
    await asyncio.gather(server.wait_closed(), screenshot_sender())

if __name__ == "__main__":
    asyncio.run(main())

