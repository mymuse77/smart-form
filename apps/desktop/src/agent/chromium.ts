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

    // 使用 persistent context 确保带有独立 Profile，且开放 CDP 调试端口
    this.context = await chromium.launchPersistentContext(profilePath, {
      headless: this.config.headless ?? false,
      args: [
        `--remote-debugging-port=${this.config.cdpPort}`,
        '--remote-debugging-address=127.0.0.1',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { width: 1280, height: 720 },
    });

    const pages = this.context.pages();
    this.taskPage = pages.length > 0 ? pages[0] : await this.context.newPage();

    return {
      page: this.taskPage,
      cdpPort: this.config.cdpPort,
    };
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
  }
}
