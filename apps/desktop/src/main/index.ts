import { app, BrowserWindow } from 'electron';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentChromiumManager } from '../agent/chromium';
import { ScreencastStreamer } from '../agent/stream';
import { ControlManager } from '../agent/control';
import { LocalDatabaseManager } from './db';

let mainWindow: BrowserWindow | null = null;
let chromiumManager: AgentChromiumManager | null = null;
let streamer: ScreencastStreamer | null = null;
let connectedClientsCount = 0;

function getAgentDashboardHTML(clientCount: number, cdpPort: number, wsPort: number) {
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
      <div class="card-title">WebSocket 端口</div>
      <div class="card-value">ws://127.0.0.1:${wsPort}</div>
      <div class="card-sub">已连接 Web 客户端: <strong id="client-count" style="color:#38bdf8">${clientCount}</strong></div>
    </div>
    <div class="card">
      <div class="card-title">CDP 调试端口</div>
      <div class="card-value">127.0.0.1:${cdpPort}</div>
      <div class="card-sub">本地 Chromium 状态: <span style="color:#34d399">RUNNING</span></div>
    </div>
  </div>

  <div class="actions">
    <button class="btn" onclick="window.electronAPI ? window.electronAPI.focusChrome() : location.reload()">置顶 Chromium 窗口</button>
    <button class="btn btn-secondary" onclick="location.reload()">刷新 Agent 状态</button>
  </div>

  <div class="log-box" id="logs">
    [${new Date().toLocaleTimeString()}] Companion Agent 初始化完成...<br/>
    [${new Date().toLocaleTimeString()}] WebSocket 服务已建立，等待 http://localhost:3000 连接...
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
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const cdpPort = parseInt(process.env.CDP_PORT || '9222', 10);
  const html = getAgentDashboardHTML(connectedClientsCount, cdpPort, 8765);
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function updateDashboardUI() {
  if (mainWindow) {
    const cdpPort = parseInt(process.env.CDP_PORT || '9222', 10);
    const html = getAgentDashboardHTML(connectedClientsCount, cdpPort, 8765);
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
}

async function startAgentServices() {
  const db = new LocalDatabaseManager();
  const control = new ControlManager();

  const cdpPort = parseInt(process.env.CDP_PORT || '9222', 10);
  chromiumManager = new AgentChromiumManager({
    cdpPort,
    tenantId: 'default',
    workspaceId: 'workspace_01',
    headless: false,
  });

  try {
    const { page } = await chromiumManager.launchOrConnect();
    console.log(`[Agent] Chromium launched with CDP port ${cdpPort}`);

    const wss = new WebSocketServer({ port: 8765 });
    console.log('[Agent] WebSocket server listening on ws://127.0.0.1:8765');

    wss.on('connection', (ws: WebSocket) => {
      connectedClientsCount++;
      updateDashboardUI();
      console.log('[Agent] Web Client connected to WebSocket');

      if (page) {
        if (streamer) streamer.stop();
        streamer = new ScreencastStreamer(page, ws, 'task_demo_01');
        streamer.start();
      }

      ws.on('message', async (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          console.log('[Agent] Received message from Web UI:', msg);
          if (msg.type === 'NAVIGATE' && msg.url) {
            await page.goto(msg.url);
          }
        } catch {
          // 二进制推流包处理忽略
        }
      });

      ws.on('close', () => {
        connectedClientsCount = Math.max(0, connectedClientsCount - 1);
        updateDashboardUI();
        console.log('[Agent] Web Client disconnected');
        if (streamer) {
          streamer.stop();
          streamer = null;
        }
      });
    });
  } catch (err) {
    console.error('[Agent] Failed to start Chromium or Agent services:', err);
  }
}

app.whenReady().then(async () => {
  await createWindow();
  await startAgentServices();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (chromiumManager) {
      chromiumManager.close();
    }
    app.quit();
  }
});
