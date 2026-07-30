import 'reflect-metadata';
import { NestFactory, type INestApplication } from '@nestjs/core';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { RealtimeHub } from './realtime-hub';

describe('realtime task channel', () => {
  let app: INestApplication;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_MODE = 'development';
    process.env.RESOURCE_REPOSITORY = 'memory';
    process.env.DEV_BEARER_TOKEN = 'smart-form-local-dev-token';
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    const server = new WebSocketServer({
      server: app.getHttpServer(),
      path: '/ws',
    });
    app.get(RealtimeHub).attach(server);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
    wsUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('authenticates an agent and routes a server-issued command to its device', async () => {
    const agent = new WebSocket(wsUrl);
    let markAuthenticated!: () => void;
    const authenticated = new Promise<void>((resolve) => {
      markAuthenticated = resolve;
    });
    const commandPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for command')), 5_000);
      agent.on('open', () => {
        agent.send(JSON.stringify({
          messageId: 'hello-1',
          type: 'client.hello',
          timestamp: new Date().toISOString(),
          payload: {
            role: 'agent',
            accessToken: 'smart-form-local-dev-token',
            deviceId: 'local-device',
          },
        }));
      });
      agent.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string; payload: Record<string, unknown> };
        if (message.type === 'server.hello') markAuthenticated();
        if (message.type === 'task.command') {
          clearTimeout(timeout);
          resolve(message.payload);
        }
      });
      agent.on('error', reject);
    });

    await Promise.race([
      authenticated,
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error('Timed out waiting for authentication')),
        5_000,
      )),
    ]);
    const now = Date.now();
    const response = await fetch(`${baseUrl}/v1/tasks/dispatch`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer smart-form-local-dev-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        protocolVersion: '1.0.0',
        commandId: 'command-1',
        taskId: 'task-1',
        tenantId: 'local-tenant',
        deviceId: 'local-device',
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
        type: 'PAUSE_TASK',
      }),
    });

    const responseBody = await response.text();
    expect(response.status, responseBody).toBe(201);
    await expect(commandPromise).resolves.toMatchObject({
      commandId: 'command-1',
      deviceId: 'local-device',
      type: 'PAUSE_TASK',
    });
    agent.close();
  });
});
