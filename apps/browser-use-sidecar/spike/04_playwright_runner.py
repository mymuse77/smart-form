"""
阶段 0 Spike 4 — Playwright Runner 基础与无死锁/无 CDP Session 冲突验证

验证内容：
1. Playwright Runner 在同一 Chromium 页面上使用语义 Locator (getByRole, getByLabel, getByText) 执行提取
2. 验证 Browser Use (探索端) 与 Playwright Runner (执行端) 共享同一 CDP 连接时的切换无死锁、无 CDP 冲突
"""

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path
from playwright.async_api import async_playwright

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

CDP_PORT = 9224
CHROMIUM_EXE = str(
    list(Path.home().glob("AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe"))[0]
)

TEST_FORM_HTML = """
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Playwright Runner Test Page</title></head>
<body>
  <h1>表单信息采集点</h1>
  <form id="user-form">
    <label for="username">用户名:</label>
    <input type="text" id="username" name="username" value="test_user_01" /><br/>

    <label for="role">角色选择:</label>
    <select id="role" name="role">
      <option value="admin">管理员</option>
      <option value="operator" selected>操作员</option>
    </select><br/>

    <button type="button" aria-label="提交表单按钮">确认提交</button>
  </form>
</body>
</html>
"""

async def run_playwright_runner_step(page):
    """Playwright Runner 回放定位与数据提取"""
    print("\n[Runner] 开始执行 Playwright Runner 语义 Locator 定位与数据提取...")
    
    # 1. getByRole (ARIA 规范：存在 aria-label 时，Accessible Name 为 aria-label 的值)
    button = page.get_by_role("button", name="提交表单按钮")
    btn_text = await button.text_content()
    print(f"  ✓ getByRole('button', name='提交表单按钮'): 找到按钮 '{btn_text}'")
    
    # 2. getByLabel
    input_elem = page.get_by_label("用户名:")
    input_val = await input_elem.input_value()
    print(f"  ✓ getByLabel('用户名:'): 提取值 '{input_val}'")
    
    # 3. getByText
    h1_elem = page.get_by_text("表单信息采集点")
    h1_text = await h1_elem.text_content()
    print(f"  ✓ getByText('表单信息采集点'): 提取标题 '{h1_text}'")
    
    return input_val == "test_user_01" and btn_text == "确认提交"


async def main():
    print("=" * 60)
    print("Spike 4: Playwright Runner 基础与 CDP Session 无冲突验证")
    print("=" * 60)

    user_data_dir = "./spike-profile-runner"
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
            # 建立第一个 CDP 连接（模拟 Browser Use 或 探索端）
            print("[CDP Session 1] 连接 CDP...")
            browser_1 = await p.chromium.connect_over_cdp(f"http://localhost:{CDP_PORT}")
            context_1 = browser_1.contexts[0]
            page_1 = context_1.pages[0] if context_1.pages else await context_1.new_page()
            
            import urllib.parse
            encoded_html = urllib.parse.quote(TEST_FORM_HTML)
            await page_1.goto(f"data:text/html;charset=utf-8,{encoded_html}")
            print("[CDP Session 1] HTML 内容加载完毕")
            
            # 执行 Runner 验证
            runner_ok = await run_playwright_runner_step(page_1)
            
            print("\n[切换测试] 模拟无缝释放 Session 1，并由 Session 2 接管...")
            # 显式关闭或者保留 connection 并开启新 Session
            await browser_1.close()
            print("[CDP Session 1] 已正常关闭")
            
            print("[CDP Session 2] 连接 CDP (模拟 Playwright Runner 独立回放)...")
            browser_2 = await p.chromium.connect_over_cdp(f"http://localhost:{CDP_PORT}")
            context_2 = browser_2.contexts[0]
            page_2 = context_2.pages[0]
            
            # 在 Session 2 下重新提取
            val = await page_2.get_by_label("用户名:").input_value()
            print(f"[CDP Session 2] 提取用户名结果: '{val}'")
            
            session_switch_ok = (val == "test_user_01")
            
            await browser_2.close()
            return runner_ok and session_switch_ok

    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        proc.terminate()
        print("▶ Chromium 已关闭")


if __name__ == "__main__":
    success = asyncio.run(main())
    print("\n============================================================")
    print(f"Spike 0.4 Playwright Runner 验证结果: {'PASS' if success else 'FAIL'}")
    print("============================================================")
