export interface ControlPlaneOptions {
  apiBaseUrl: string;
  wsUrl: string;
  accessToken: string;
  deviceId: string;
  workspaceId: string;
}

export interface ControlPlaneMessage {
  type: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}

export interface AcceptedTask {
  accepted: true;
  commandId: string;
  task: {
    id: string;
    mode: 'read' | 'write';
    site: { entryUrl: string };
  };
  matchedResources: unknown[];
}

export class ControlPlaneClient {
  private socket: WebSocket | null = null;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer?: number;
  private heartbeatTimer?: number;
  private readonly messageListeners = new Set<(message: ControlPlaneMessage) => void>();
  private readonly frameListeners = new Set<(frame: ArrayBuffer) => void>();
  private readonly statusListeners = new Set<(connected: boolean) => void>();

  constructor(private readonly options: ControlPlaneOptions) {
    if (!options.accessToken) throw new Error('An OIDC access token is required');
  }

  onMessage(listener: (message: ControlPlaneMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onFrame(listener: (frame: ArrayBuffer) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStatus(listener: (connected: boolean) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.openSocket();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    this.socket?.close(1000, 'Web client stopping');
    this.socket = null;
  }

  createTask(message: string): Promise<AcceptedTask> {
    return this.post('/v1/tasks/from-chat', {
      message,
      deviceId: this.options.deviceId,
      workspaceId: this.options.workspaceId,
    }) as Promise<AcceptedTask>;
  }

  async controlTask(
    taskId: string,
    type: 'PAUSE_TASK' | 'REQUEST_TAKEOVER' | 'RESUME_AFTER_HUMAN'
      | 'CANCEL_TASK' | 'APPROVE_SUBMIT' | 'REJECT_SUBMIT',
    submissionId?: string,
  ): Promise<void> {
    await this.post(`/v1/tasks/${encodeURIComponent(taskId)}/control`, {
      type,
      ...(submissionId ? { submissionId } : {}),
    });
  }

  private openSocket(): void {
    const socket = new WebSocket(this.options.wsUrl);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.onopen = () => {
      this.sendMessage('client.hello', {
        role: 'web',
        accessToken: this.options.accessToken,
      });
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        for (const listener of this.frameListeners) listener(event.data);
        return;
      }
      if (typeof event.data !== 'string') return;
      try {
        const message = JSON.parse(event.data) as ControlPlaneMessage;
        if (message.type === 'server.hello') {
          this.reconnectAttempt = 0;
          for (const listener of this.statusListeners) listener(true);
          this.startHeartbeat();
        }
        for (const listener of this.messageListeners) listener(message);
      } catch {
        socket.close(4000, 'Invalid control-plane message');
      }
    };
    socket.onclose = () => {
      if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
      for (const listener of this.statusListeners) listener(false);
      this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.sendMessage('client.heartbeat', { role: 'web' });
      }
    }, 30_000);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay);
  }

  private sendMessage(type: string, payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      messageId: crypto.randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      payload,
    }));
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.options.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof payload.message === 'string'
        ? payload.message
        : `Control plane request failed with HTTP ${response.status}`);
    }
    return payload;
  }
}

