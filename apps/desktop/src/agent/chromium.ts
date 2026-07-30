import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

export interface ChromiumConfig {
  cdpPort: number;
  tenantId: string;
  workspaceId: string;
  userDataBaseDir?: string;
  headless?: boolean;
}

export class AgentChromiumManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private taskPage: Page | null = null;

  constructor(private config: ChromiumConfig) {}

  public async launchOrConnect(): Promise<{ page: Page; cdpPort: number }> {
    const baseDir = this.config.userDataBaseDir || path.join(process.cwd(), 'profiles');
    const profilePath = path.join(baseDir, this.config.tenantId, this.config.workspaceId);

    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true });
    }

    // 1. 优先尝试连接已存在的 CDP 调试端口
    try {
      this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.config.cdpPort}`);
      const contexts = this.browser.contexts();
      if (contexts.length > 0) {
        this.context = contexts[0];
        const pages = this.context.pages();
        this.taskPage = pages.length > 0 ? pages[0] : await this.context.newPage();
        console.log(`[ChromiumManager] Successfully connected to existing Chromium over CDP at 127.0.0.1:${this.config.cdpPort}`);
        return { page: this.taskPage, cdpPort: this.config.cdpPort };
      }
    } catch {
      // 端口未监听，准备拉起全新的 persistent context 实例
    }

    const commonArgs = [
      `--remote-debugging-port=${this.config.cdpPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
    ];

    // 2. 依次尝试：Playwright 内置 Chromium ➔ 本地原生 Chrome ➔ 本地原生 Edge
    const launchOptionsList = [
      { headless: this.config.headless ?? false, args: commonArgs, viewport: { width: 1280, height: 720 } },
      { headless: this.config.headless ?? false, channel: 'chrome', args: commonArgs, viewport: { width: 1280, height: 720 } },
      { headless: this.config.headless ?? false, channel: 'msedge', args: commonArgs, viewport: { width: 1280, height: 720 } },
    ];

    let lastError: any = null;
    for (const options of launchOptionsList) {
      try {
        this.context = await chromium.launchPersistentContext(profilePath, options as any);
        const pages = this.context.pages();
        this.taskPage = pages.length > 0 ? pages[0] : await this.context.newPage();
        console.log(`[ChromiumManager] Successfully launched Chromium with ${options.channel ? 'channel=' + options.channel : 'default chromium'}`);
        return {
          page: this.taskPage,
          cdpPort: this.config.cdpPort,
        };
      } catch (err: any) {
        lastError = err;
      }
    }

    console.error(`[ChromiumManager] Error launching Chromium:`, lastError?.message || lastError);
    throw lastError;
  }

  public getTaskPage(): Page | null {
    return this.taskPage;
  }

  public async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.taskPage = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
