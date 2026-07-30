import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';

export interface ChromiumConfig {
  cdpPort?: number;
  tenantId: string;
  workspaceId: string;
  userDataBaseDir: string;
  headless?: boolean;
}

export interface ManagedChromiumSession {
  page: Page;
  context: BrowserContext;
  cdpEndpoint: string;
  profilePath: string;
}

async function reserveAvailableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate a loopback CDP port'));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function validatePathSegment(label: string, value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`${label} contains unsafe path characters`);
  }
  return value;
}

export class AgentChromiumManager {
  private context: BrowserContext | null = null;
  private taskPage: Page | null = null;
  private activeSession: ManagedChromiumSession | null = null;

  constructor(private readonly config: ChromiumConfig) {}

  async launch(): Promise<ManagedChromiumSession> {
    if (this.activeSession) {
      throw new Error('Managed Chromium is already running');
    }

    const tenantId = validatePathSegment('tenantId', this.config.tenantId);
    const workspaceId = validatePathSegment('workspaceId', this.config.workspaceId);
    const profilePath = path.resolve(
      this.config.userDataBaseDir,
      tenantId,
      workspaceId,
    );
    const expectedRoot = `${path.resolve(this.config.userDataBaseDir)}${path.sep}`;
    if (!profilePath.startsWith(expectedRoot)) {
      throw new Error('Resolved browser profile escaped the configured profile root');
    }
    await fs.promises.mkdir(profilePath, { recursive: true });

    const cdpPort = this.config.cdpPort ?? await reserveAvailableLoopbackPort();
    const commonArgs = [
      `--remote-debugging-port=${cdpPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
    ];
    const launchOptions = [
      { args: commonArgs },
      { channel: 'chrome', args: commonArgs },
      { channel: 'msedge', args: commonArgs },
    ] as const;

    let lastError: unknown;
    for (const option of launchOptions) {
      try {
        this.context = await chromium.launchPersistentContext(profilePath, {
          ...option,
          headless: this.config.headless ?? false,
          viewport: { width: 1280, height: 720 },
        });
        const pages = this.context.pages();
        this.taskPage = pages[0] ?? await this.context.newPage();
        this.activeSession = {
          page: this.taskPage,
          context: this.context,
          cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
          profilePath,
        };
        return this.activeSession;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error('Unable to launch a managed Chromium instance', {
      cause: lastError,
    });
  }

  getSession(): ManagedChromiumSession | null {
    return this.activeSession;
  }

  getTaskPage(): Page | null {
    return this.taskPage;
  }

  async getTaskTargetId(): Promise<string> {
    if (!this.context || !this.taskPage) {
      throw new Error('Managed Chromium is not running');
    }
    const session = await this.context.newCDPSession(this.taskPage);
    try {
      const result = await session.send('Target.getTargetInfo') as {
        targetInfo: { targetId: string };
      };
      return result.targetInfo.targetId;
    } finally {
      await session.detach();
    }
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = null;
    this.taskPage = null;
    this.activeSession = null;
    if (context) await context.close();
  }
}
