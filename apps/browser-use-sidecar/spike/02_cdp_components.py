"""
阶段 0 Spike 2 - Playwright CDP 连接验证
验证 Playwright connectOverCDP 能否连接本地可见 Chromium，
并执行基础导航和内容提取。
同时验证 React/Vue 受控组件 change 事件兼容性。
"""
import asyncio
import subprocess
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


CDP_PORT = 9222

# 用 Playwright 管理的 Chromium 路径
CHROMIUM_EXE = str(
    list(Path.home().glob("AppData/Local/ms-playwright/chromium-*/chrome-win64/chrome.exe"))[0]
)


async def test_cdp_basic():
    """验证 CDP 连接与基础操作"""
    from playwright.async_api import async_playwright

    print("\n[>>] Starting Chromium with CDP port", CDP_PORT)
    proc = subprocess.Popen(
        [
            CHROMIUM_EXE,
            f"--remote-debugging-port={CDP_PORT}",
            "--user-data-dir=./spike-cdp-profile",
            "--no-first-run",
            "--no-default-browser-check",
            "--window-size=1280,720",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"[OK] Chromium started (PID={proc.pid}), waiting 3s...")
    time.sleep(3)

    try:
        async with async_playwright() as p:
            print("[>>] Connecting via CDP...")
            browser = await p.chromium.connect_over_cdp(f"http://localhost:{CDP_PORT}")
            print(f"[OK] CDP connected! Browser: {browser.version}")

            ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()

            # 基础导航
            await page.goto("https://example.com")
            title = await page.title()
            h1 = await page.locator("h1").text_content()
            print(f"[OK] Page title: {title}")
            print(f"[OK] H1 content: {h1}")

            # 页面隔离检查
            total_pages = len(ctx.pages)
            print(f"[OK] Context has {total_pages} page(s) (isolation check)")

            await browser.close()
            return True

    except Exception as e:
        print(f"[FAIL] CDP error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        proc.terminate()
        print("[OK] Chromium terminated")


CONTROLLED_COMPONENT_HTML = """
<!DOCTYPE html><html><head><meta charset="UTF-8">
<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
</head><body>
<div>
  <input id="native" type="text">
  <span id="native-out">-</span>
  <script>
    document.getElementById('native').addEventListener('input', e => {
      document.getElementById('native-out').textContent = e.target.value;
    });
  </script>
</div>
<div id="react-root"></div>
<script>
  const {useState,createElement:h} = React;
  function App() {
    const [v,setV] = useState('');
    return h('div',null,
      h('input',{id:'react-inp',type:'text',value:v,
        onChange:e=>{setV(e.target.value);}}),
      h('span',{id:'react-out'},v)
    );
  }
  ReactDOM.createRoot(document.getElementById('react-root')).render(h(App));
</script>
<div id="vue-root">
  <input id="vue-inp" v-model="val" type="text">
  <span id="vue-out">{{val}}</span>
</div>
<script>
  const {createApp,ref} = Vue;
  createApp({setup(){return{val:ref('')};}}).mount('#vue-root');
</script>
</body></html>
"""


async def test_controlled_components():
    """验证 CDP/Playwright fill 是否触发 React/Vue 受控组件 change 事件"""
    from playwright.async_api import async_playwright

    print("\n[>>] Testing controlled component change events...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, slow_mo=100)
        page = await browser.new_page()
        await page.set_content(CONTROLLED_COMPONENT_HTML)
        await page.wait_for_timeout(2000)  # 等待 React/Vue 初始化

        results = {}

        # 测试 1：原生 input
        await page.locator("#native").fill("hello-native")
        await page.wait_for_timeout(300)
        v = await page.locator("#native-out").text_content()
        results["native_fill"] = v == "hello-native"
        print(f"  Native input fill: {'OK' if results['native_fill'] else 'FAIL'} (got: {v!r})")

        # 测试 2：React fill
        react_inp = page.locator("#react-inp")
        await react_inp.fill("hello-react")
        await page.wait_for_timeout(300)
        v = await page.locator("#react-out").text_content()
        results["react_fill"] = "hello-react" in (v or "")
        print(f"  React fill():       {'OK' if results['react_fill'] else 'FAIL'} (got: {v!r})")

        # 如果 fill 不触发 React onChange，尝试 press_sequentially
        if not results["react_fill"]:
            await react_inp.click()
            await react_inp.press("Control+a")
            await react_inp.press_sequentially("hello-react-kbd", delay=30)
            await page.wait_for_timeout(300)
            v = await page.locator("#react-out").text_content()
            results["react_keyboard"] = "hello-react-kbd" in (v or "")
            print(f"  React keyboard:     {'OK' if results['react_keyboard'] else 'FAIL'} (got: {v!r})")
        
        # 测试 3：Vue v-model fill
        vue_inp = page.locator("#vue-inp")
        await vue_inp.fill("hello-vue")
        await page.wait_for_timeout(300)
        v = await page.locator("#vue-out").text_content()
        results["vue_fill"] = "hello-vue" in (v or "")
        print(f"  Vue fill():         {'OK' if results['vue_fill'] else 'FAIL'} (got: {v!r})")

        if not results["vue_fill"]:
            await vue_inp.click()
            await vue_inp.press("Control+a")
            await vue_inp.press_sequentially("hello-vue-kbd", delay=30)
            await page.wait_for_timeout(300)
            v = await page.locator("#vue-out").text_content()
            results["vue_keyboard"] = "hello-vue-kbd" in (v or "")
            print(f"  Vue keyboard:       {'OK' if results.get('vue_keyboard') else 'FAIL'} (got: {v!r})")

        await page.wait_for_timeout(2000)
        await browser.close()
        return results


async def main():
    print("=" * 60)
    print("Spike 2: Playwright CDP + Controlled Components")
    print("=" * 60)

    cdp_ok = await test_cdp_basic()
    print(f"\n[>>] CDP test: {'PASS' if cdp_ok else 'FAIL'}")

    comp_results = await test_controlled_components()

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  CDP connection:     {'PASS' if cdp_ok else 'FAIL'}")
    print(f"  Native input fill:  {'PASS' if comp_results.get('native_fill') else 'FAIL'}")
    print(f"  React onChange:     {'PASS' if comp_results.get('react_fill') or comp_results.get('react_keyboard') else 'FAIL'}")
    print(f"  Vue v-model:        {'PASS' if comp_results.get('vue_fill') or comp_results.get('vue_keyboard') else 'FAIL'}")
    
    react_method = "fill()" if comp_results.get("react_fill") else ("press_sequentially()" if comp_results.get("react_keyboard") else "NONE")
    vue_method = "fill()" if comp_results.get("vue_fill") else ("press_sequentially()" if comp_results.get("vue_keyboard") else "NONE")
    print(f"\n  Recommended method for React: {react_method}")
    print(f"  Recommended method for Vue:   {vue_method}")

    return cdp_ok and (comp_results.get("react_fill") or comp_results.get("react_keyboard"))


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
