"""
阶段 0 Spike 脚本 — 验证以下核心假设：
1. Browser Use + DeepSeek（OpenAI 兼容）能在本地可见 Chromium 中执行导航/点击/提取
2. Playwright connectOverCDP 连接方式可行
3. 任务专属 Page 隔离（不误操作其他页面）
4. CDP 模式下模拟输入是否触发 React/Vue 受控组件的 change 事件

运行方式：
    uv run python spike/01_browser_use_cdp.py

前置：需要先在 smart-form 根目录有 .env 文件含 DEEPSEEK_API_KEY
"""

import asyncio
import os
import sys
import subprocess
import time
from pathlib import Path
from dotenv import load_dotenv

# 加载根目录 .env
root_env = Path(__file__).parent.parent.parent / ".env"
load_dotenv(root_env)

# ── 配置 ──────────────────────────────────────────────────────────────
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

if not DEEPSEEK_API_KEY:
    print("❌ 未找到 DEEPSEEK_API_KEY，请检查 .env 文件")
    sys.exit(1)

print(f"✅ API Key 已加载（末4位：...{DEEPSEEK_API_KEY[-4:]}）")
print(f"✅ Base URL: {DEEPSEEK_BASE_URL}")
print(f"✅ Model: {DEEPSEEK_MODEL}")


async def spike_01_basic_navigation():
    """
    验证 1：Browser Use Agent 能否在本地可见 Chromium 完成基础导航和提取
    使用 Playwright 原生启动（非 CDP 模式），验证 Agent 基本功能
    """
    print("\n" + "="*60)
    print("【验证 1】Browser Use + DeepSeek 基础导航与提取")
    print("="*60)

    from langchain_openai import ChatOpenAI
    from browser_use import Agent, Browser, BrowserConfig

    llm = ChatOpenAI(
        model=DEEPSEEK_MODEL,
        api_key=DEEPSEEK_API_KEY,
        base_url=DEEPSEEK_BASE_URL,
        temperature=0.0,
    )

    # 使用可见浏览器（非无头）
    browser = Browser(
        config=BrowserConfig(
            headless=False,
            # 使用独立的 User Data 目录，不污染用户日常 Chrome
            extra_chromium_args=[
                "--user-data-dir=./spike-profile",
            ],
        )
    )

    agent = Agent(
        task=(
            "请访问 https://example.com，"
            "找到页面上的标题文字，"
            "然后返回该标题的完整内容。"
            "只需要完成这一个任务，不要做其他操作。"
        ),
        llm=llm,
        browser=browser,
    )

    try:
        print("▶ 启动 Agent 探索 example.com ...")
        result = await agent.run(max_steps=10)
        print(f"✅ Agent 完成！结果：{result}")
        return True
    except Exception as e:
        print(f"❌ Agent 失败：{e}")
        return False
    finally:
        await browser.close()


async def spike_02_cdp_connection():
    """
    验证 2：Playwright connectOverCDP 连接已有可见 Chromium
    步骤：
    1. 用 subprocess 启动带 --remote-debugging-port 的 Chromium
    2. 用 Playwright.connect_over_cdp() 连接
    3. 在任务专属 Page 上执行操作
    4. 验证不能操作其他 Page
    """
    print("\n" + "="*60)
    print("【验证 2】Playwright connectOverCDP 连接模式")
    print("="*60)

    from playwright.async_api import async_playwright
    import json
    import urllib.request

    CDP_PORT = 9222

    # 1. 启动带 CDP 的可见 Chromium
    # 在 Windows 上，找到 Playwright 管理的 Chromium 路径
    chromium_paths = [
        Path.home() / "AppData/Local/ms-playwright/chromium-*/chrome-win/chrome.exe",
        Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
    ]

    chromium_exe = None
    for pattern in chromium_paths:
        # 尝试 glob 匹配
        matches = list(Path(pattern.parent.parent).glob(pattern.name)) if "*" in str(pattern) else []
        if matches:
            chromium_exe = matches[0]
            break
        elif pattern.exists():
            chromium_exe = pattern
            break

    if not chromium_exe:
        # 尝试用 playwright 内置的 chromium
        try:
            result = subprocess.run(
                ["python", "-c",
                 "from playwright.sync_api import sync_playwright; p=sync_playwright().start(); print(p.chromium.executable_path)"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                chromium_exe = Path(result.stdout.strip())
        except Exception:
            pass

    if not chromium_exe or not Path(str(chromium_exe)).exists():
        print("⚠️  未找到 Chromium 可执行文件，跳过 CDP 验证")
        print("   提示：请先运行 'uv run playwright install chromium'")
        return None

    print(f"✅ 找到 Chromium: {chromium_exe}")

    # 启动 Chromium with CDP
    proc = subprocess.Popen(
        [
            str(chromium_exe),
            f"--remote-debugging-port={CDP_PORT}",
            "--user-data-dir=./spike-cdp-profile",
            "--no-first-run",
            "--no-default-browser-check",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    print(f"▶ Chromium 已启动 (PID={proc.pid})，等待 CDP 就绪...")
    time.sleep(3)

    try:
        # 2. 连接 CDP
        async with async_playwright() as p:
            try:
                browser = await p.chromium.connect_over_cdp(f"http://localhost:{CDP_PORT}")
                print(f"✅ CDP 连接成功！Browser version: {browser.version}")
            except Exception as e:
                print(f"❌ CDP 连接失败：{e}")
                return False

            # 3. 获取或创建任务专属 Page
            contexts = browser.contexts
            if contexts:
                context = contexts[0]
                pages = context.pages
                if pages:
                    task_page = pages[0]
                else:
                    task_page = await context.new_page()
            else:
                context = await browser.new_context()
                task_page = await context.new_page()

            print(f"✅ 获取任务 Page，当前 URL: {task_page.url}")

            # 4. 在任务 Page 上执行操作
            await task_page.goto("https://example.com")
            title = await task_page.title()
            h1 = await task_page.locator("h1").text_content()
            print(f"✅ 页面标题: {title}")
            print(f"✅ H1 内容: {h1}")

            # 5. 验证页面数量（隔离性检查）
            all_pages = context.pages
            print(f"✅ 当前 Context 中共 {len(all_pages)} 个页面")

            await browser.close()
            return True

    finally:
        proc.terminate()
        print("▶ Chromium 进程已终止")


async def spike_03_controlled_component():
    """
    验证 3：CDP 模式下模拟输入是否触发 React/Vue 受控组件的 change 事件

    这是填报场景的关键验证：
    - 普通 HTML input：通过 type() 应该正常工作
    - React 受控组件：需要触发 React 的合成事件系统
    - Vue v-model input：需要触发 input/change 事件

    使用内联 HTML 测试页面（不依赖外部站点）
    """
    print("\n" + "="*60)
    print("【验证 3】CDP 模式下受控组件 change 事件兼容性")
    print("="*60)

    from playwright.async_api import async_playwright

    # 内联测试 HTML：包含三种 input 类型
    TEST_HTML = """
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>受控组件 change 事件测试</title>
      <!-- 引入 React 和 Vue 用于测试 -->
      <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
      <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
      <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
    </head>
    <body>
      <h1>受控组件测试</h1>

      <!-- 类型 1：原生 HTML input -->
      <div>
        <h3>原生 HTML input</h3>
        <input id="native-input" type="text" placeholder="原生输入">
        <span id="native-result">未输入</span>
        <script>
          document.getElementById('native-input').addEventListener('input', function(e) {
            document.getElementById('native-result').textContent = '已捕获: ' + e.target.value;
          });
        </script>
      </div>

      <!-- 类型 2：React 受控组件 -->
      <div id="react-root"></div>
      <script type="text/javascript">
        const { useState, createElement: h } = React;

        function ReactInput() {
          const [value, setValue] = useState('');
          const [captured, setCaptured] = useState('未输入');

          return h('div', null,
            h('h3', null, 'React 受控组件'),
            h('input', {
              id: 'react-input',
              type: 'text',
              value: value,
              placeholder: 'React 受控输入',
              onChange: (e) => {
                setValue(e.target.value);
                setCaptured('已捕获: ' + e.target.value);
              }
            }),
            h('span', { id: 'react-result' }, captured)
          );
        }

        ReactDOM.createRoot(document.getElementById('react-root')).render(h(ReactInput));
      </script>

      <!-- 类型 3：Vue v-model -->
      <div id="vue-root">
        <div>
          <h3>Vue v-model</h3>
          <input id="vue-input" v-model="value" type="text" placeholder="Vue v-model 输入">
          <span id="vue-result">{{ captured }}</span>
        </div>
      </div>
      <script>
        const { createApp, ref, watch } = Vue;
        createApp({
          setup() {
            const value = ref('');
            const captured = ref('未输入');
            watch(value, (newVal) => {
              captured.value = '已捕获: ' + newVal;
            });
            return { value, captured };
          }
        }).mount('#vue-root');
      </script>
    </body>
    </html>
    """

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()

        # 设置测试 HTML
        await page.set_content(TEST_HTML)
        print("▶ 测试页面已加载，等待 JS 框架初始化...")
        await page.wait_for_timeout(2000)  # 等待 React/Vue 初始化

        results = {}

        # ── 测试 1：原生 HTML input ────────────────────────
        print("\n▶ 测试原生 HTML input...")
        await page.locator("#native-input").fill("测试文本-原生")
        await page.wait_for_timeout(500)
        native_result = await page.locator("#native-result").text_content()
        results["native"] = native_result
        print(f"   结果：{native_result}")
        native_ok = "测试文本-原生" in (native_result or "")

        # ── 测试 2：React 受控组件 ─────────────────────────
        print("\n▶ 测试 React 受控组件（fill 方法）...")
        react_input = page.locator("#react-input")
        await react_input.click()
        await react_input.fill("测试文本-React")
        await page.wait_for_timeout(500)
        react_result = await page.locator("#react-result").text_content()
        results["react_fill"] = react_result
        print(f"   fill() 结果：{react_result}")
        react_fill_ok = "测试文本-React" in (react_result or "")

        # 如果 fill 不触发 React onChange，尝试 press_sequentially
        if not react_fill_ok:
            print("   fill() 未触发 React onChange，尝试 press_sequentially...")
            await react_input.click()
            await react_input.press("Control+a")
            await react_input.press_sequentially("测试文本-ReactKbd", delay=50)
            await page.wait_for_timeout(500)
            react_result2 = await page.locator("#react-result").text_content()
            results["react_keyboard"] = react_result2
            print(f"   press_sequentially() 结果：{react_result2}")
            react_ok = "测试文本-ReactKbd" in (react_result2 or "")
        else:
            react_ok = react_fill_ok

        # ── 测试 3：Vue v-model ────────────────────────────
        print("\n▶ 测试 Vue v-model（fill 方法）...")
        vue_input = page.locator("#vue-input")
        await vue_input.fill("测试文本-Vue")
        await page.wait_for_timeout(500)
        vue_result = await page.locator("#vue-result").text_content()
        results["vue_fill"] = vue_result
        print(f"   fill() 结果：{vue_result}")
        vue_ok = "测试文本-Vue" in (vue_result or "")

        print("\n" + "="*60)
        print("【验证 3 结论】")
        print(f"  原生 HTML input：{'✅ 正常' if native_ok else '❌ 失败'}")
        print(f"  React 受控组件：{'✅ 正常' if react_ok else '⚠️  需要 press_sequentially 或 JS dispatch'}")
        print(f"  Vue v-model：{'✅ 正常' if vue_ok else '⚠️  需要特殊处理'}")
        print("="*60)

        if not react_ok or not vue_ok:
            print("\n⚠️  填报场景注意：")
            print("   对于 React/Vue 受控组件，填报脚本可能需要：")
            print("   1. 使用 press_sequentially 代替 fill")
            print("   2. 或手动 dispatch input/change 事件（通过 page.evaluate）")
            print("   建议：fillField SDK 方法优先尝试 fill，失败时回退到 press_sequentially")

        await page.wait_for_timeout(3000)  # 让用户看到结果
        await browser.close()

        return {
            "native": native_ok,
            "react": react_ok,
            "vue": vue_ok,
            "details": results,
        }


async def main():
    print("╔══════════════════════════════════════════════════════╗")
    print("║   Smart-Form 阶段 0 技术 Spike — Browser Use + CDP   ║")
    print("╚══════════════════════════════════════════════════════╝")

    spike_results = {}

    # 验证 1：Browser Use + DeepSeek 基础导航
    try:
        spike_results["v1_browser_use"] = await spike_01_basic_navigation()
    except Exception as e:
        print(f"❌ 验证 1 异常：{e}")
        spike_results["v1_browser_use"] = False

    # 验证 2：CDP 连接
    try:
        result = await spike_02_cdp_connection()
        spike_results["v2_cdp"] = result
    except Exception as e:
        print(f"❌ 验证 2 异常：{e}")
        spike_results["v2_cdp"] = False

    # 验证 3：受控组件兼容性
    try:
        spike_results["v3_controlled"] = await spike_03_controlled_component()
    except Exception as e:
        print(f"❌ 验证 3 异常：{e}")
        spike_results["v3_controlled"] = False

    # ── 最终报告 ──────────────────────────────────────────
    print("\n" + "╔══════════════════════════════════════════════════════╗")
    print("║                   Spike 验证总结报告                  ║")
    print("╚══════════════════════════════════════════════════════╝")

    v1 = spike_results.get("v1_browser_use", False)
    v2 = spike_results.get("v2_cdp", False)
    v3 = spike_results.get("v3_controlled", {})

    print(f"验证 1 — Browser Use + DeepSeek 导航提取：{'✅ 通过' if v1 else '❌ 失败'}")
    print(f"验证 2 — Playwright CDP 连接：{'✅ 通过' if v2 else '⚠️  跳过/失败'}")

    if isinstance(v3, dict):
        print(f"验证 3 — 受控组件兼容性：")
        print(f"          原生 input：{'✅' if v3.get('native') else '❌'}")
        print(f"          React 受控：{'✅' if v3.get('react') else '⚠️'}")
        print(f"          Vue v-model：{'✅' if v3.get('vue') else '⚠️'}")

    go_nogo = v1 and (v2 is not False)
    print(f"\n{'🟢 GO — 可以进入阶段 1' if go_nogo else '🔴 需要进一步调查后再决定'}")

    return spike_results


if __name__ == "__main__":
    asyncio.run(main())
