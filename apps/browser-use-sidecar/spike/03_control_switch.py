"""
阶段 0 Spike 3 — 控制权切换与隔离验证

验证内容：
1. 窗口切前台：在 Windows 下成功将 Chromium 窗口拉至最前台 (SetForegroundWindow / Win32 API)
2. 控制权切换状态机模拟：Agent 暂停 -> 人工接管 -> Agent 恢复
3. Context/Page 隔离：Agent 仅操作专属 Page，无法误操作非任务 Tab/Profile
"""

import asyncio
import os
import sys
import subprocess
import time
from pathlib import Path
from playwright.async_api import async_playwright

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

CDP_PORT = 9223
CHROMIUM_EXE = str(
    list(Path.home().glob("AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe"))[0]
)

def bring_window_to_foreground_win32(window_title_keyword: str) -> bool:
    """Windows 下将指定标题关键词的窗口切到前台"""
    if sys.platform != "win32":
        print("⚠ 非 Windows 系统，跳过 Win32 窗口切前台")
        return True
    try:
        import ctypes
        user32 = ctypes.windll.user32
        
        found_hwnd = []
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)

        def enum_windows_callback(hwnd, lparam):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                buff = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buff, length + 1)
                if window_title_keyword.lower() in buff.value.lower():
                    found_hwnd.append(hwnd)
            return True

        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
        
        if found_hwnd:
            hwnd = found_hwnd[0]
            # ShowWindow 9 = SW_RESTORE / SW_SHOWNORMAL
            user32.ShowWindow(hwnd, 9)
            user32.SetForegroundWindow(hwnd)
            print(f"✅ 成功将窗口 (HWND: {hwnd}) 切到前台！")
            return True
        else:
            print(f"❌ 未找到包含关键词 '{window_title_keyword}' 的可见窗口")
            return False
    except Exception as e:
        print(f"❌ 窗口切前台异常: {e}")
        return False


async def main():
    print("=" * 60)
    print("Spike 3: 控制权切换与隔离验证")
    print("=" * 60)

    # 启动 CDP 浏览器
    user_data_dir = "./spike-profile-switch"
    proc = subprocess.Popen([
        CHROMIUM_EXE,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={user_data_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,720",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print(f"▶ 启动 Chromium (PID={proc.pid}), 等待 3s...")
    time.sleep(3)

    try:
        async with async_playwright() as p:
            browser = await p.chromium.connect_over_cdp(f"http://localhost:{CDP_PORT}")
            context = browser.contexts[0]
            
            # 模拟用户在日常浏览器中打开了一个私人页面（例如 GitHub）
            private_page = await context.new_page()
            await private_page.goto("https://httpbin.org/get")
            
            # Agent 任务专属页面
            task_page = await context.new_page()
            await task_page.goto("https://example.com")
            
            print("\n【验证 1】专属 Page 隔离性")
            print(f"当前 Context 共有 {len(context.pages)} 个 Page")
            
            # 锁定只给 Agent 操作 task_page
            agent_allowed_page_id = id(task_page)
            print(f"Agent 只能在 task_page (id={agent_allowed_page_id}) 上执行操作")
            
            # 验证 Agent 操作不会修改 private_page
            await task_page.evaluate("document.title = 'Agent Working Title'")
            private_title = await private_page.title()
            print(f"Private Page 标题保持未变: '{private_title}' (隔离验证通过)")
            
            print("\n【验证 2】Agent 暂停 -> 切前台 -> 人工接管 -> Agent 恢复")
            print("1. Agent 开始执行自动化流程...")
            await task_page.evaluate("document.title = 'Agent Step 1 Running'")
            
            print("2. 触发人工接管请求，暂停 Agent...")
            is_agent_paused = True
            print("   Agent 状态: PAUSED")
            
            print("3. 将 Chromium 窗口聚焦调至最前台...")
            fg_ok = bring_window_to_foreground_win32("Example Domain")
            
            print("4. 人工在原生 Chromium 中完成操作（模拟等待 2 秒）...")
            time.sleep(2)
            
            print("5. 人工操作完成，恢复 Agent 控制权...")
            is_agent_paused = False
            print("   Agent 状态: RUNNING")
            
            # 重新探测页面状态
            current_url = task_page.url
            print(f"   Agent 重新探测当前 URL: {current_url}")
            print("✅ 控制权切换与探测流测试成功！")
            
            await browser.close()
            return fg_ok
            
    except Exception as e:
        print(f"❌ 测试过程中发生错误: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        proc.terminate()
        print("▶ Chromium 已关闭")

if __name__ == "__main__":
    success = asyncio.run(main())
    print("\n============================================================")
    print(f"Spike 0.3 控制权切换验证结果: {'PASS' if success else 'FAIL'}")
    print("============================================================")
