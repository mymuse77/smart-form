"""
阶段 0 & 阶段 1 核心 Sidecar 引擎 — 支持复杂 Browser-Use 串行任务操作与实时画面推帧

运行方式：
  uv run --directory apps/browser-use-sidecar python spike/02_screenshot_stream.py
"""

import asyncio
import ctypes
import hashlib
import json
import os
import re
import struct
import sys
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

import websockets
from dotenv import load_dotenv
from playwright.async_api import async_playwright
from pydantic import BaseModel, Field

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
    """在 Windows 下尝试将 Chrome/Chromium 浏览器窗口切回最前台"""
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
                if any(k in title for k in [keyword, "Chromium", "小红书", "什么值得买", "验证", "Example", "理想"]):
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
    """编码二进制图像帧协议 header + payload"""
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


# WebSocket 客户端连接池与状态管理
clients = set()
task_queue = asyncio.Queue()
agent_paused = False
submit_approval_event = asyncio.Event()
submit_approval_result = False


class ExtractedDataItem(BaseModel):
    """提取的数据条目"""
    title: str = Field(..., description="数据项名称、标题或主文本内容")
    url: Optional[str] = Field(default=None, description="相关跳转 URL 链接")
    price: Optional[str] = Field(default=None, description="价格信息（如有）")
    details: Dict[str, str] = Field(default_factory=dict, description="其他扩展字段与键值信息")


class TaskResultSchema(BaseModel):
    """复杂串行任务/提取任务的统一结构化输出结果"""
    status: str = Field(..., description="任务执行状态: success, partial_success, or failed")
    summary: str = Field(..., description="整体执行总结或回答内容")
    extracted_items: List[ExtractedDataItem] = Field(default_factory=list, description="提取到的结构化列表数据")
    completed_steps: List[str] = Field(default_factory=list, description="已完成的串行步骤列表")


def extract_clean_url(text: str) -> Optional[str]:
    match = re.search(r'https?://[a-zA-Z0-9.\-]+(?::\d+)?(?:/[^\s\u4e00-\u9fa5,"\'“”‘’()]*)?', text)
    if match:
        return match.group(0).rstrip('./,;!')
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


def parse_serial_steps(text: str) -> List[str]:
    """
    解析自然语言文本中的串行多步骤操作：
    支持中文/英文标点、句号、逗号、'并'、'然后'、'接着'、空格前缀谓语等拆分
    """
    raw_steps = re.split(r'(?:\r?\n|;|；|。|\.|\d+[\.、])', text)
    steps = [s.strip() for s in raw_steps if s.strip()]

    if len(steps) <= 1:
        raw_steps = re.split(r'(?:,|,|，|、|并|然后再|然后|接着|之后|再下一步|再|\s+(?=点击|选择|进入|抓取|拉取|从上往下|滚动))', text)
        steps = [s.strip() for s in raw_steps if s.strip()]

    return steps if steps else [text.strip()]


def extract_all_click_targets(text: str) -> List[str]:
    """
    从自然语言中按顺序提取所有连续点击/悬停/滚动目标，例如：
    '打开... 点击"技术"菜单，点击“纯电技术”，从上往下拉取...' -> ['技术', '纯电技术', '拉取滚动']
    """
    targets = []
    # 1. 优先提取包含引号的: 点击"xxx" / 点击“xxx”
    quoted = re.findall(r'(?:点击|选择|进入)?["“\'`]([^"”\'`]+)["”\'`]', text)
    for q in quoted:
        clean_q = q.strip().replace("菜单", "").replace("按钮", "")
        if clean_q and clean_q not in targets:
            targets.append(clean_q)

    # 2. 检查是否有明确的页面滚动拉取指示
    if any(k in text for k in ["拉取", "从上往下", "向下滚动", "滚动页面", "滑动"]):
        targets.append("拉取滚动")

    # 3. 补充提取无引号的: 点击xxx
    if not targets:
        unquoted = re.findall(r'点击\s*([^\s,，;；"”\'`\.。!！?？]+?)(?:[,\s，;；\.。!！?？]|然后|并|再|$)', text)
        for u in unquoted:
            clean_u = u.strip().replace("菜单", "").replace("按钮", "")
            if clean_u and clean_u not in ["按钮", "链接", "菜单"] and clean_u not in targets:
                targets.append(clean_u)

    return targets


async def execute_sequential_clicks(page, targets: List[str], ws) -> bool:
    """
    通用物理点击、Hover 与滚动连贯驱动器：
    依次查找页面中匹配 target 的可交互节点，支持 hover 唤出下拉子菜单及模拟页面向下滚动拉取
    """
    for target in targets:
        if target == "拉取滚动" or any(k in target for k in ["拉取", "滚动", "滑动", "从上往下"]):
            print(f"📜 [串行探针] 执行页面从上往下拉取/滚动操作 ...")
            await broadcast_json({
                "type": "step_executed",
                "action": "正在执行页面向下滚动拉取与内容加载...",
                "locator": "window.scrollBy(0, 800)"
            })
            await page.evaluate("window.scrollBy(0, 800)")
            await asyncio.sleep(1.0)
            await page.evaluate("window.scrollBy(0, 800)")
            await asyncio.sleep(1.0)
            await flush_screen_frames(page, ws, count=3)
            continue

        print(f"🖱️ [串行探针] 正在寻址并物理交互目标: \"{target}\" ...")
        await broadcast_json({
            "type": "step_executed",
            "action": f"正在驱动可见 Chromium 寻址并交互目标: \"{target}\"",
            "locator": f"click/hover(\"{target}\")"
        })

        success = False
        try:
            locators = page.get_by_text(target, exact=False)
            count = await locators.count()

            for i in range(count):
                loc = locators.nth(i)
                try:
                    if await loc.is_visible():
                        await loc.scroll_into_view_if_needed()
                        await loc.hover()
                        await asyncio.sleep(0.4)
                        await loc.click(force=True, timeout=3000)
                        success = True
                        print(f"  ✓ 成功 hover & 点击目标 [\"{target}\"] (节点 index={i})")
                        break
                except Exception as item_err:
                    print(f"  交互节点 {i} 提示: {item_err}")

            if not success:
                elem = await page.query_selector(f"a:has-text('{target}'), button:has-text('{target}'), div:has-text('{target}')")
                if elem:
                    await elem.hover()
                    await asyncio.sleep(0.4)
                    await elem.click(force=True, timeout=3000)
                    success = True
                    print(f"  ✓ 成功 DOM hover & 点击目标 [\"{target}\"]")

            if success:
                await asyncio.sleep(1.5)
                await flush_screen_frames(page, ws, count=3)
            else:
                print(f"  ⚠ 未在当前页面找到匹配 \"{target}\" 的可点击控件")

        except Exception as err:
            print(f"  物理串行交互异常: {err}")

    return True


async def handler(ws):
    global agent_paused, submit_approval_result
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
                        url = extract_clean_url(text) or data.get('url')
                        print(f"  [WS 服务端] 入列新任务: \"{text}\" (模式: {mode}, URL: {url})")
                        agent_paused = False
                        await task_queue.put({
                            "text": text,
                            "mode": mode,
                            "url": url,
                            "raw_msg": data
                        })
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
                except Exception as err:
                    print(f"  ⚠ 消息解析提示: {err}")
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


async def flush_screen_frames(page, ws, count: int = 3):
    """
    视觉与回复同步节奏门 (Visual Rhythm Gate)：
    向前端推送 N 帧最新画面，确保用户在 Chat 弹出回复前看到最新渲染
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
        await asyncio.sleep(0.2)


async def detect_captcha_or_login(page) -> bool:
    """通用反爬与人机验证风控感知器"""
    try:
        url = page.url.lower()
        canvas_blockers = await page.query_selector_all("canvas, iframe[src*='captcha'], iframe[src*='challenge'], [class*='captcha']")
        if len(canvas_blockers) > 0 and ("login" in url or "verify" in url or "check" in url):
            return True
    except Exception:
        pass
    return False


DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")


async def run_browser_use_agent_serial(page, serial_task_text: str, ws) -> TaskResultSchema:
    """
    接入官方 Browser Use Agent 核心引擎执行复杂的串行任务
    """
    print(f"🤖 [Browser Use Serial Agent] 开始执行串行任务: \"{serial_task_text}\"")

    steps = parse_serial_steps(serial_task_text)
    target_count = extract_target_count(serial_task_text)
    print(f"  📋 解构出 {len(steps)} 个串行步骤: {steps}，期望抓取数量={target_count}")

    try:
        from langchain_openai import ChatOpenAI
        from browser_use import Agent

        if DEEPSEEK_API_KEY:
            llm = ChatOpenAI(
                model=DEEPSEEK_MODEL,
                api_key=DEEPSEEK_API_KEY,
                base_url=DEEPSEEK_BASE_URL,
                temperature=0.0,
            )
        elif OPENAI_API_KEY:
            llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.0)
        else:
            raise ValueError("未配置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY，无法启动 Browser Use Agent 引擎")

        prompt = f"""
你是一个专业的网页自动化与数据提取 Agent。请按顺序在当前页面完成以下复杂的串行任务操作：

任务总览：
{serial_task_text}

分解串行步骤：
"""
        for idx, s in enumerate(steps, 1):
            prompt += f"步骤 {idx}: {s}\n"

        prompt += f"""
关键要求：
1. 严格按步骤顺序依次在页面上交互（导航 -> 点击/悬停菜单 -> 切换子菜单 -> 从上往下拉取/滚动页面 -> 提取内容）。
2. 如果遇到下拉菜单，请先将鼠标悬停(hover)到一级菜单上，待下拉浮层出现后再点击对应的二级菜单。
3. 请最终抓取 {target_count} 条最新技术内容/文章信息，并返回结构化输出。
"""

        agent = Agent(
            task=prompt,
            llm=llm,
            page=page,
            output_model_schema=TaskResultSchema
        )

        async def on_step_executed(agent_step_data):
            try:
                action_name = getattr(agent_step_data, 'action', '正在执行多步推理与 DOM 交互')
                print(f"  ⚡ [Step] {action_name}")
                await broadcast_json({
                    "type": "step_executed",
                    "action": f"Agent 步骤执行: {action_name}",
                    "url": page.url
                })
                await flush_screen_frames(page, ws, count=2)
            except Exception:
                pass

        if hasattr(agent, "register_new_step_callback"):
            agent.register_new_step_callback(on_step_executed)

        print("  ▶ Agent 开始多步物理交互与链式推理...")
        history = await agent.run(max_steps=12)
        await flush_screen_frames(page, ws, count=3)

        final_res = history.final_result()
        if final_res and isinstance(final_res, TaskResultSchema):
            print(f"  ✅ Browser Use Agent 任务成功完成，获取到强类型结构化结果！")
            return final_res
        elif final_res and hasattr(history, 'structured_output') and history.structured_output:
            return history.structured_output
        else:
            res_str = str(final_res or history.final_result() or "已成功完成串行操作")
            print(f"  ✅ Browser Use Agent 执行完毕，文本结果: {res_str}")
            lines = [line.strip() for line in res_str.split("\n") if line.strip()]
            items = [ExtractedDataItem(title=line, url=page.url) for line in lines[:target_count]]
            return TaskResultSchema(
                status="success",
                summary=res_str[:200],
                extracted_items=items if items else [ExtractedDataItem(title=res_str, url=page.url)],
                completed_steps=steps
            )

    except Exception as err:
        print(f"  ⚠ Browser Use Agent 执行逻辑提示: {err}")
        return TaskResultSchema(
            status="partial_success",
            summary=f"Agent 执行提示: {err}",
            extracted_items=[],
            completed_steps=steps
        )


async def smart_semantic_extract(page, target_url: str, target_count: int = 10) -> List[Dict[str, Any]]:
    """通用的 DOM 增强型备用提取引擎（支持单页/卡片布局）"""
    extracted_items = []
    seen_titles = set()

    # 1. 尝试表格结构
    try:
        rows = await page.query_selector_all("table tbody tr, table tr")
        if rows and len(rows) > 0:
            for row in rows:
                tds = await row.query_selector_all("td, th")
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

    # 2. 纯结构 DOM 块/卡片/链接通用提取
    try:
        candidate_elements = await page.evaluate("""() => {
            const nodes = Array.from(document.querySelectorAll('a[href], article, section, h1, h2, h3, h4, div[class*="title"], div[class*="card"], div[class*="item"]'));
            const results = [];
            for (const el of nodes) {
                const text = (el.innerText || el.textContent || '').trim();
                if (!text || text.length < 4) continue;
                // 过滤掉包含大量换行的顶层大容器
                if (text.split('\\n').length > 5) continue;
                const href = el.getAttribute ? (el.getAttribute('href') || '') : '';
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
        print(f"  DOM 提取提示: {e}")

    return extracted_items


async def screenshot_sender():
    global agent_paused
    await asyncio.sleep(1.5)
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
        current_loaded_url = ""
        print("▶ 截图采集端启动就绪，保持 Context 处于待机状态，准备接收串行任务...")

        try:
            async with websockets.connect(f"ws://localhost:{WS_PORT}") as ws:
                print("✅ 复杂 Browser-Use 串行 Sidecar 引擎连接成功...")
                frame_seq = 0
                last_hash = ""

                while True:
                    t_start = time.time()

                    if not task_queue.empty() and not agent_paused:
                        task_item = await task_queue.get()
                        task_text = task_item["text"]
                        task_mode = task_item["mode"]
                        target_url = task_item["url"] or current_loaded_url

                        print(f"▶ 开始处理串行任务: Mode={task_mode}, URL={target_url}, Text=\"{task_text}\"")

                        try:
                            if target_url and target_url != current_loaded_url:
                                print(f"▶ 驱动 Chromium 导航至目标 URL: {target_url} ...")
                                await page.goto(target_url, wait_until="domcontentloaded", timeout=15000)
                                current_loaded_url = target_url
                                await broadcast_json({"type": "url_changed", "url": target_url})

                            await flush_screen_frames(page, ws, count=2)

                            is_blocked = await detect_captcha_or_login(page)
                            if is_blocked:
                                print(f"⚠️ [反爬告警] 目标站点 ({target_url}) 触发了验证码/风控！自动切窗口至前台...")
                                agent_paused = True
                                await broadcast_json({
                                    "type": "human_intervention_required",
                                    "reason": "检测到目标站点提示“验证码/操作过于频繁”，已将窗口切至前台，请手动完成验证后点击恢复。",
                                    "targetUrl": target_url,
                                })
                                bring_window_to_foreground()
                                task_queue.task_done()
                                continue

                            # 1. 尝试提取指令中的所有物理点击/悬停/滚动目标（如 ['技术', '纯电技术', '拉取滚动']）
                            click_targets = extract_all_click_targets(task_text)
                            if click_targets:
                                print(f"🖱️ 捕获到 {len(click_targets)} 个串行物理点击/悬停/滚动目标: {click_targets}")
                                await execute_sequential_clicks(page, click_targets, ws)

                            target_count = extract_target_count(task_text)

                            # 2. 如果配置了 LLM，则由 Browser Use Agent 继续深度驱动并结构化抽取
                            if DEEPSEEK_API_KEY or OPENAI_API_KEY:
                                task_result_schema = await run_browser_use_agent_serial(page, task_text, ws)
                                items_to_return = [
                                    {"title": item.title, "url": item.url or page.url, "details": item.details}
                                    for item in task_result_schema.extracted_items
                                ]
                            else:
                                extracted = await smart_semantic_extract(page, page.url, target_count=target_count)
                                items_to_return = extracted
                                task_result_schema = TaskResultSchema(
                                    status="success",
                                    summary=f"已成功通过串行探针导航并提取 {len(extracted)} 条数据",
                                    completed_steps=[task_text]
                                )

                            await flush_screen_frames(page, ws, count=3)
                            await asyncio.sleep(0.5)

                            print(f"✅ 成功完成串行任务，回传 {len(items_to_return)} 条结构化数据及执行结果...")
                            await broadcast_json({
                                "type": "task_result",
                                "mode": task_mode,
                                "targetUrl": page.url,
                                "taskText": task_text,
                                "count": len(items_to_return),
                                "items": items_to_return,
                                "summary": task_result_schema.summary,
                                "completedSteps": task_result_schema.completed_steps
                            })

                        except Exception as task_err:
                            print(f"⚠ 任务执行过程发生异常: {task_err}")
                        finally:
                            task_queue.task_done()

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
            print(f"❌ 截图与通信引擎异常：{e}")
        finally:
            await browser.close()


async def main():
    print(f"▶ 启动 Sidecar WebSocket 服务端 ws://127.0.0.1:{WS_PORT} ...")
    try:
        server = await websockets.serve(handler, "127.0.0.1", WS_PORT)
    except OSError as err:
        if err.errno == 10048:
            print(f"⚠️ 端口 {WS_PORT} 已被占用，请确保先关闭运行中的旧 Sidecar 进程。")
            return
        raise err
    print("✅ 复杂 Browser-Use 串行任务引擎初始化就绪！")
    await asyncio.gather(server.wait_closed(), screenshot_sender())


if __name__ == "__main__":
    asyncio.run(main())
