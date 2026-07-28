"""
阶段 0 Spike 1 - Browser Use + DeepSeek 基础验证
验证 Browser Use Agent 能否通过 OpenAI 兼容协议调用 DeepSeek，
在本地可见 Chromium 中完成基础导航和页面内容提取。
"""
import asyncio
import os
import sys
from pathlib import Path

# Windows 终端 UTF-8 兼容
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from dotenv import load_dotenv

root_env = Path(__file__).parent.parent.parent.parent / ".env"
load_dotenv(root_env)

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

print("=" * 60)
print("Spike 1: Browser Use + DeepSeek")
print("=" * 60)

if not DEEPSEEK_API_KEY:
    print("[FAIL] DEEPSEEK_API_KEY not found. Check .env file.")
    sys.exit(1)

print(f"[OK] API Key loaded (...{DEEPSEEK_API_KEY[-4:]})")
print(f"[OK] Base URL: {DEEPSEEK_BASE_URL}")
print(f"[OK] Model: {DEEPSEEK_MODEL}")


async def run():
    from browser_use.llm import ChatOpenAI
    from browser_use import Agent, Browser, BrowserProfile

    llm = ChatOpenAI(
        model=DEEPSEEK_MODEL,
        api_key=DEEPSEEK_API_KEY,
        base_url=DEEPSEEK_BASE_URL,
        temperature=0.0,
    )
    print(f"[OK] LLM initialized: {DEEPSEEK_MODEL}")

    browser = Browser(
        headless=False,
        user_data_dir="./spike-profile-01",
    )

    agent = Agent(
        task=(
            "Go to https://example.com. "
            "Find the h1 heading text on the page. "
            "Return the exact text of the h1 element. "
            "Do only this one task."
        ),
        llm=llm,
        browser=browser,
    )

    print("\n[>>] Starting Browser Use Agent on example.com ...")
    try:
        result = await agent.run(max_steps=10)
        print(f"\n[OK] Agent completed! Result: {result}")
        return True
    except Exception as e:
        print(f"\n[FAIL] Agent error: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        await browser.close()


if __name__ == "__main__":
    success = asyncio.run(run())
    sys.exit(0 if success else 1)
