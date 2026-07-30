import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { AgentChromiumManager } from '../agent/chromium';
import { ScreencastStreamer } from '../agent/stream';
import { AgentRealtimeClient } from '../agent/realtime-client';
import { ArtifactLoader } from '../agent/artifact-loader';
import { loadArtifactTrust } from '../agent/artifact-trust';
import { BrowserControlAuthority } from '../agent/control-lease';
import { RunnerExecutorAdapter } from '../agent/runner-executor';
import { SidecarProcessClient } from '../agent/sidecar-client';
import { SidecarExecutorAdapter } from '../agent/sidecar-executor';
import {
  DesktopTaskOrchestrator,
  type AutomationExecutorAdapter,
} from '../agent/task-orchestrator';
import type { AutomationExecutor } from '../agent/control-lease';
import { LocalDatabaseManager } from './db';

let mainWindow: BrowserWindow | null = null;
let chromiumManager: AgentChromiumManager | null = null;
let streamer: ScreencastStreamer | null = null;
let localDatabase: LocalDatabaseManager | null = null;
let realtimeClient: AgentRealtimeClient | null = null;
let sidecarClient: SidecarProcessClient | null = null;
let taskOrchestrator: DesktopTaskOrchestrator | null = null;
let connectedClientsCount = 0;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

function getAgentDashboardHTML(clientCount: number, cdpPort: number, serverUrl: string) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Smart-Form Companion Agent</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      padding: 24px;
      user-select: none;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #1e293b;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .title { font-size: 18px; font-weight: 600; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    .status-badge {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 12px;
      background: #064e3b;
      color: #34d399;
      border: 1px solid #059669;
      font-weight: 500;
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .card {
      background: #1e293b;
      border-radius: 8px;
      padding: 16px;
      border: 1px solid #334155;
    }
    .card-title { font-size: 12px; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px; }
    .card-value { font-size: 20px; font-weight: bold; color: #f1f5f9; }
    .card-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
    .actions { display: flex; gap: 12px; }
    .btn {
      flex: 1;
      padding: 10px;
      background: #0284c7;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      transition: background 0.2s;
    }
    .btn:hover { background: #0369a1; }
    .btn-secondary { background: #334155; }
    .btn-secondary:hover { background: #475569; }
    .log-box {
      margin-top: 20px;
      background: #020617;
      border-radius: 6px;
      padding: 12px;
      font-family: monospace;
      font-size: 12px;
      color: #a7f3d0;
      height: 120px;
      overflow-y: auto;
      border: 1px solid #1e293b;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">🤖 Companion Agent 运行中</div>
    <div class="status-badge">ONLINE</div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-title">云端控制面</div>
      <div class="card-value" style="font-size:14px">${escapeHtml(serverUrl)}</div>
      <div class="card-sub">服务端连接: <strong id="client-count" style="color:#38bdf8">${clientCount ? 'ONLINE' : 'OFFLINE'}</strong></div>
    </div>
    <div class="card">
      <div class="card-title">CDP 调试端口</div>
      <div class="card-value">127.0.0.1:${cdpPort}</div>
      <div class="card-sub">本地 Chromium 状态: <span style="color:#34d399">RUNNING</span></div>
    </div>
  </div>

  <div class="actions">
    <button class="btn" onclick="window.smartFormAgent && window.smartFormAgent.focusChromium()">置顶 Chromium 窗口</button>
    <button class="btn btn-secondary" onclick="location.reload()">刷新 Agent 状态</button>
  </div>

  <div class="log-box" id="logs">
    [${new Date().toLocaleTimeString()}] Companion Agent 初始化完成...<br/>
    [${new Date().toLocaleTimeString()}] 正在建立到控制面的出站 WebSocket 连接...
  </div>
</body>
</html>`;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 480,
    resizable: false,
    title: 'Smart-Form Companion Agent',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const cdpPort = parseInt(process.env.CDP_PORT || '0', 10);
  const html = getAgentDashboardHTML(
    connectedClientsCount,
    cdpPort,
    process.env.SERVER_WS_URL || 'ws://127.0.0.1:3001/ws',
  );
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function updateDashboardUI() {
  if (mainWindow) {
    const cdpPort = chromiumManager?.getSession()
      ? Number(new URL(chromiumManager.getSession()!.cdpEndpoint).port)
      : parseInt(process.env.CDP_PORT || '0', 10);
    const html = getAgentDashboardHTML(
      connectedClientsCount,
      cdpPort,
      process.env.SERVER_WS_URL || 'ws://127.0.0.1:3001/ws',
    );
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
}

async function startAgentServices() {
  localDatabase = await LocalDatabaseManager.open(path.join(app.getPath('userData'), 'agent-state'));
  const tenantId = process.env.TENANT_ID || 'local-tenant';
  const deviceId = process.env.DEVICE_ID || 'local-device';
  const workspaceId = process.env.WORKSPACE_ID || 'local-workspace';
  const serverWsUrl = process.env.SERVER_WS_URL || 'ws://127.0.0.1:3001/ws';
  const accessToken = process.env.DEVICE_ACCESS_TOKEN
    || (process.env.NODE_ENV === 'production' ? '' : 'smart-form-local-dev-token');
  if (!accessToken) {
    throw new Error('DEVICE_ACCESS_TOKEN is required in production');
  }

  const configuredCdpPort = process.env.CDP_PORT
    ? parseInt(process.env.CDP_PORT, 10)
    : undefined;
  chromiumManager = new AgentChromiumManager({
    cdpPort: configuredCdpPort,
    tenantId,
    workspaceId,
    userDataBaseDir: path.join(app.getPath('userData'), 'profiles'),
    headless: false,
  });

  const { page, cdpEndpoint } = await chromiumManager.launch();
  console.log(`[Agent] Managed Chromium launched at ${cdpEndpoint}`);
  const trustedSigningKeys = await loadArtifactTrust({
    configuredKeysJson: process.env.ARTIFACT_SIGNING_PUBLIC_KEYS_JSON,
    nodeEnv: process.env.NODE_ENV || 'development',
    serverWsUrl,
    accessToken,
  });
    const artifactOrigin = new URL(serverWsUrl);
    artifactOrigin.protocol = artifactOrigin.protocol === 'wss:' ? 'https:' : 'http:';
    const artifactLoader = new ArtifactLoader({
      environment: {
        tenantId,
        deviceId,
        protocolVersion: '1.0.0',
        sdkVersion: process.env.CAPABILITY_SDK_VERSION || '0.1.0',
        playwrightVersion: require('playwright/package.json').version as string,
        nodeVersion: process.versions.node,
        browser: 'chromium',
        executionMode: 'cdp',
      },
      trustedSigningKeys,
      accessToken,
      localArtifactRoot: path.resolve(process.env.ARTIFACT_ROOT || 'data/artifacts'),
      allowedHttpsOrigins: [artifactOrigin.origin],
    });
    realtimeClient = new AgentRealtimeClient({
      serverUrl: serverWsUrl,
      accessToken,
      tenantId,
      deviceId,
      protocolVersion: '1.0.0',
    }, localDatabase);
    realtimeClient.onConnected(() => {
      connectedClientsCount = 1;
      updateDashboardUI();
    });
    realtimeClient.onDisconnected(() => {
      connectedClientsCount = 0;
      updateDashboardUI();
    });
    realtimeClient.onError((error) => {
      console.error('[Agent] Realtime error:', error.message);
    });
    const sidecarExecutable = process.env.SIDECAR_EXECUTABLE
      || (process.env.NODE_ENV === 'production' ? '' : 'uv');
    if (!sidecarExecutable) {
      throw new Error('SIDECAR_EXECUTABLE is required in production');
    }
    const sidecarCwd = path.resolve(
      process.env.SIDECAR_WORKING_DIRECTORY || 'apps/browser-use-sidecar',
    );
    const sidecarArgs = process.env.SIDECAR_ARGS_JSON
      ? JSON.parse(process.env.SIDECAR_ARGS_JSON) as string[]
      : ['run', 'python', '-m', 'smart_form_sidecar.worker'];
    if (!Array.isArray(sidecarArgs) || sidecarArgs.some((value) => typeof value !== 'string')) {
      throw new Error('SIDECAR_ARGS_JSON must be a JSON string array');
    }
    sidecarClient = new SidecarProcessClient({
      executable: sidecarExecutable,
      args: sidecarArgs,
      cwd: sidecarCwd,
      onDiagnostic: (message) => console.warn(`[Sidecar] ${message}`),
    });
    const frames = {
      start: (taskId: string) => {
        streamer?.stop();
        streamer = new ScreencastStreamer(page, realtimeClient!, taskId);
        streamer.start();
      },
      stop: () => streamer?.stop(),
    };
    taskOrchestrator = new DesktopTaskOrchestrator({
      tenantId,
      deviceId,
      protocolVersion: '1.0.0',
      page,
      database: localDatabase,
      artifactLoader,
      control: new BrowserControlAuthority(),
      executors: new Map<AutomationExecutor, AutomationExecutorAdapter>([
        ['playwright-runner', new RunnerExecutorAdapter()],
        ['browser-use-sidecar', new SidecarExecutorAdapter(
          sidecarClient,
          cdpEndpoint,
          () => chromiumManager!.getTaskTargetId(),
        )],
      ]),
      frames,
      reports: realtimeClient,
      probeBrowser: async () => ({
        url: page.url(),
        title: await page.title(),
        activeTargetId: await chromiumManager!.getTaskTargetId(),
      }),
    });
  realtimeClient.onCommand((command) => {
    void taskOrchestrator!.handle(command).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Agent] Command handling failed: ${message}`);
    });
  });
  await realtimeClient.start().catch((error: Error) => {
    if (process.env.NODE_ENV === 'production') throw error;
    console.warn(`[Agent] Control plane is not available yet: ${error.message}`);
  });
}

void app.whenReady().then(async () => {
  ipcMain.handle('agent:focus-chromium', async () => {
    const page = chromiumManager?.getTaskPage();
    if (!page) return false;
    await page.bringToFront();
    return true;
  });
  await createWindow();
  await startAgentServices();
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Agent] Fatal startup failure: ${message}`);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (chromiumManager) {
      void chromiumManager.close();
    }
    void localDatabase?.close().finally(() => app.quit());
  }
});

app.on('before-quit', () => {
  streamer?.stop();
  realtimeClient?.stop();
  void sidecarClient?.shutdown();
  ipcMain.removeHandler('agent:focus-chromium');
});
