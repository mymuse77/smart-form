import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSidecarEnvironment, SidecarProcessClient } from './sidecar-client';

const clients: SidecarProcessClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.stop();
});

describe('SidecarProcessClient', () => {
  it('passes only the minimum environment into the worker', () => {
    expect(buildSidecarEnvironment({
      PATH: 'path',
      OPENAI_API_KEY: 'model-secret',
      BROWSER_USE_MODEL: 'model',
      DEVICE_ACCESS_TOKEN: 'must-not-leak',
      ARTIFACT_SIGNING_PUBLIC_KEYS_JSON: 'must-not-leak',
    })).toEqual({
      PATH: 'path',
      OPENAI_API_KEY: 'model-secret',
      BROWSER_USE_MODEL: 'model',
    });
  });

  it('uses versioned line-delimited IPC for execution and control', async () => {
    const client = new SidecarProcessClient({
      executable: process.execPath,
      args: [path.resolve('tests/fixtures/fake-sidecar.cjs')],
      cwd: process.cwd(),
      startupTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    });
    clients.push(client);

    await client.start();
    const result = await client.execute({
      taskId: 'task-1',
      cdpEndpoint: 'http://127.0.0.1:49222',
      targetId: 'target-1',
      prompt: 'Collect orders',
      allowedDomains: ['forms.example.com'],
      maxSteps: 10,
    });
    expect(result).toMatchObject({
      type: 'result',
      status: 'succeeded',
      payload: { final_result: 'done' },
    });
    await client.control('pause', 'task-1');
    await client.shutdown();
  });
});

