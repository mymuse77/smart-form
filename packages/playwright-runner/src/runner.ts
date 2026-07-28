import { chromium, Page } from 'playwright';

export interface ReplayOptions {
  cdpPort?: number;
  targetUrl: string;
  maxRetries?: number;
}

export class PlaywrightRunnerEngine {
  public static async executeScript(
    scriptFn: (page: Page) => Promise<Record<string, any>[]>,
    options: ReplayOptions
  ): Promise<{ success: boolean; data: Record<string, any>[]; error?: string }> {
    try {
      let page: Page;
      let browserCloseFn = async () => {};

      if (options.cdpPort) {
        const browser = await chromium.connectOverCDP(`http://localhost:${options.cdpPort}`);
        const contexts = browser.contexts();
        const ctx = contexts.length > 0 ? contexts[0] : await browser.newContext();
        page = await ctx.newPage();
        browserCloseFn = async () => { await page.close(); await browser.close(); };
      } else {
        const browser = await chromium.launch({ headless: true });
        const ctx = await browser.newContext();
        page = await ctx.newPage();
        browserCloseFn = async () => { await browser.close(); };
      }

      const data = await scriptFn(page);
      await browserCloseFn();
      return { success: true, data };
    } catch (err: any) {
      return { success: false, data: [], error: err.message || String(err) };
    }
  }
}
