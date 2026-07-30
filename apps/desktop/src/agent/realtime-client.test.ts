import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRealtimeClient, type RealtimeOutbox } from './realtime-client';
import type { OutboxRecord } from '../main/db';

class MemoryOutbox implements RealtimeOutbox {
  readonly records: OutboxRecord[] = [];

  async enqueueReport(report: OutboxRecord): Promise<void> {
    this.records.push(report);
  }

  listOutbox(): OutboxRecord[] {
    return [...this.records];
  }

  async acknowledgeReport(reportId: string): Promise<void> {
    const index = this.records.findIndex((record) => record.reportId === reportId);
    if (index >= 0) this.records.splice(index, 1);
  }
}

const servers: WebSocketServer[] = [];
const clients: AgentRealtimeClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.stop();
  for (const server of servers.splice(0)) server.close();
});

async function createServer() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (typeof address === 'string') throw new Error('Expected TCP address');
  return {
    server,
    url: `ws://127.0.0.1:${address.port}`,
  };
}

describe('AgentRealtimeClient', () => {
  it('authenticates without putting the access token in the URL and receives commands', async () => {
    const { server, url } = await createServer();
    const receivedHello = vi.fn();
    server.on('connection', (socket, request) => {
      expect(request.url).not.toContain('token');
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string; payload: Record<string, unknown> };
        if (message.type === 'client.hello') {
          receivedHello(message.payload);
          socket.send(JSON.stringify({
            messageId: 'server-hello',
            type: 'server.hello',
            timestamp: new Date().toISOString(),
            payload: { authenticated: true },
          }));
          const now = Date.now();
          socket.send(JSON.stringify({
            messageId: 'task-command',
            type: 'task.command',
            timestamp: new Date().toISOString(),
            payload: {
              protocolVersion: '1.0.0',
              commandId: 'command-1',
              taskId: 'task-1',
              tenantId: 'tenant-1',
              deviceId: 'device-1',
              issuedAt: new Date(now).toISOString(),
              expiresAt: new Date(now + 60_000).toISOString(),
              type: 'PAUSE_TASK',
            },
          }));
        }
      });
    });
    const client = new AgentRealtimeClient({
      serverUrl: url,
      accessToken: 'secret-device-token',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      protocolVersion: '1.0.0',
      reconnect: false,
    }, new MemoryOutbox());
    clients.push(client);
    const command = new Promise((resolve) => client.onCommand(resolve));

    await client.start();

    await expect(command).resolves.toMatchObject({ commandId: 'command-1' });
    expect(receivedHello).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'secret-device-token',
      deviceId: 'device-1',
    }));
  });

  it('queues reports while disconnected', async () => {
    const outbox = new MemoryOutbox();
    const client = new AgentRealtimeClient({
      serverUrl: 'ws://127.0.0.1:65530',
      accessToken: 'secret-device-token',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      protocolVersion: '1.0.0',
      reconnect: false,
    }, outbox);
    clients.push(client);

    await client.sendReport({
      protocolVersion: '1.0.0',
      reportId: 'report-1',
      type: 'TASK_EVENT',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      taskId: 'task-1',
      sequence: 1,
      timestamp: new Date().toISOString(),
      payload: { state: 'PAUSED' },
    });

    expect(outbox.records).toHaveLength(1);
  });

  it('flushes queued reports, sends live reports and frames after authentication', async () => {
    const { server, url } = await createServer();
    const receivedTypes: string[] = [];
    const binaryFrames: Buffer[] = [];
    server.on('connection', (socket) => {
      socket.on('message', (raw, isBinary) => {
        if (isBinary) {
          binaryFrames.push(Buffer.from(raw as Buffer));
          return;
        }
        const message = JSON.parse(raw.toString()) as { type: string };
        receivedTypes.push(message.type);
        if (message.type === 'client.hello') {
          socket.send(JSON.stringify({
            messageId: 'hello',
            type: 'server.hello',
            timestamp: new Date().toISOString(),
            payload: { authenticated: true },
          }));
        } else if (message.type === 'agent.report') {
          const parsed = JSON.parse(raw.toString()) as {
            payload: { reportId: string };
          };
          socket.send(JSON.stringify({
            messageId: `ack-${parsed.payload.reportId}`,
            type: 'agent.report_ack',
            timestamp: new Date().toISOString(),
            payload: { reportId: parsed.payload.reportId },
          }));
        }
      });
    });
    const outbox = new MemoryOutbox();
    await outbox.enqueueReport({
      reportId: 'queued-report',
      taskId: 'task-1',
      sequence: 1,
      payload: {
        protocolVersion: '1.0.0',
        reportId: 'queued-report',
        type: 'TASK_EVENT',
        tenantId: 'tenant-1',
        deviceId: 'device-1',
        taskId: 'task-1',
        sequence: 1,
        timestamp: new Date().toISOString(),
        payload: { state: 'PAUSED' },
      },
      createdAt: Date.now(),
    });
    const client = new AgentRealtimeClient({
      serverUrl: url,
      accessToken: 'secret-device-token',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      protocolVersion: '1.0.0',
      reconnect: false,
    }, outbox);
    clients.push(client);

    await client.start();
    await client.sendReport({
      protocolVersion: '1.0.0',
      reportId: 'live-report',
      type: 'TASK_EVENT',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      taskId: 'task-1',
      sequence: 2,
      timestamp: new Date().toISOString(),
      payload: { state: 'RUNNING' },
    });
    expect(client.isAvailable()).toBe(true);
    expect(client.sendFrame(Buffer.from('frame'))).toBe(true);
    for (
      let attempt = 0;
      attempt < 50 && (
        outbox.records.length > 0
        || binaryFrames.length === 0
        || receivedTypes.filter((type) => type === 'agent.report').length < 2
      );
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(outbox.records).toHaveLength(0);
    expect(receivedTypes.filter((type) => type === 'agent.report')).toHaveLength(2);
    expect(binaryFrames).toEqual([Buffer.from('frame')]);
    await expect(client.sendReport({
      protocolVersion: '1.0.0',
      reportId: 'wrong-device',
      type: 'TASK_EVENT',
      tenantId: 'tenant-1',
      deviceId: 'device-2',
      sequence: 3,
      timestamp: new Date().toISOString(),
      payload: {},
    })).rejects.toThrow('identity');
  });

  it('allows plaintext WS only for loopback development endpoints', () => {
    expect(() => new AgentRealtimeClient({
      serverUrl: 'ws://control.example.com/ws',
      accessToken: 'token',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      protocolVersion: '1.0.0',
    }, new MemoryOutbox())).toThrow('require WSS');
  });
});
