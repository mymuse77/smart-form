import { createServer, type Server } from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  signArtifactReference,
} from '@smart-form/capability-sdk';
import type {
  AgentCommand,
  AgentReport,
  ArtifactReference,
  CapabilityArtifactBundle,
  RuntimeCompatibility,
  StartTaskCommand,
  TaskDefinition,
} from '@smart-form/contracts';
import { chromium, type Browser } from 'playwright';
import { ArtifactLoader } from '../../apps/desktop/src/agent/artifact-loader';
import { BrowserControlAuthority } from '../../apps/desktop/src/agent/control-lease';
import { RunnerExecutorAdapter } from '../../apps/desktop/src/agent/runner-executor';
import {
  DesktopTaskOrchestrator,
  type AutomationExecutorAdapter,
} from '../../apps/desktop/src/agent/task-orchestrator';
import { LocalDatabaseManager } from '../../apps/desktop/src/main/db';

const compatibility: RuntimeCompatibility = {
  protocolVersion: '1.0.0',
  sdkRange: '>=0.1.0',
  playwrightRange: '>=1.50.0',
  nodeRange: '>=20',
  browser: 'chromium',
  executionModes: ['cdp'],
};
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const tempDirectories: string[] = [];
let server: Server;
let browser: Browser;
let origin: string;
let submittedBody = '';

beforeAll(async () => {
  const readHtml = await fs.promises.readFile(
    path.resolve('tests/sites/read.html'),
    'utf8',
  );
  const writeHtml = await fs.promises.readFile(
    path.resolve('tests/sites/write.html'),
    'utf8',
  );
  server = createServer((request, response) => {
    if (request.url === '/read') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(readHtml);
      return;
    }
    if (request.url === '/write') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(writeHtml);
      return;
    }
    if (request.url === '/submit' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        submittedBody = Buffer.concat(chunks).toString('utf8');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<h1 id="receipt">Order created</h1>');
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock site did not bind');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await Promise.all(tempDirectories.map(
    (directory) => fs.promises.rm(directory, { recursive: true, force: true }),
  ));
});

function task(mode: 'read' | 'write'): TaskDefinition {
  const now = new Date().toISOString();
  return {
    id: `task-${mode}`,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    title: `${mode} orders`,
    description: `${mode} orders`,
    taskType: mode === 'read' ? 'collect' : 'fill',
    mode,
    site: {
      entryUrl: `${origin}/${mode}`,
      allowedDomains: ['127.0.0.1'],
    },
    target: {
      entity: 'order',
      fields: mode === 'read'
        ? [
          { name: 'id', label: 'ID', type: 'string', required: true },
          { name: 'amount', label: 'Amount', type: 'decimal', required: true },
        ]
        : [{ name: 'orderNumber', label: 'Order number', type: 'string', required: true }],
    },
    ...(mode === 'write' ? { input: { values: { orderNumber: 'A-202' } } } : {}),
    output: { format: 'jsonl', destination: 'local' },
    budget: {
      maxSteps: 100,
      stepTimeoutMs: 30_000,
      totalTimeoutMs: 60_000,
      maxCostUsd: 1,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function bundle(mode: 'read' | 'write'): Buffer {
  const program: CapabilityArtifactBundle['program'] = mode === 'read'
    ? [{
      type: 'extract',
      collectionSelector: '.order',
      maxRecords: 100,
      fields: [
        { name: 'id', selector: '.id', read: 'text' },
        { name: 'amount', selector: '.amount', read: 'text' },
      ],
    }]
    : [
      {
        type: 'fill',
        selector: '#order-number',
        value: { source: 'input', key: 'orderNumber' },
      },
      {
        type: 'submit',
        selector: '#commit-order',
        snapshotKeys: ['orderNumber'],
      },
    ];
  return Buffer.from(JSON.stringify({
    format: 'smart-form-capability-v1',
    manifest: {
      schemaVersion: '1.1',
      capabilityId: `orders-${mode}`,
      version: '1.0.0',
      tenantId: 'tenant-1',
      name: `Orders ${mode}`,
      taskType: mode === 'read' ? 'collect' : 'fill',
      mode,
      site: {
        domains: ['127.0.0.1'],
        entryUrlPatterns: [`${origin}/*`],
        module: 'orders',
      },
      runtime: { ...compatibility, language: 'declarative-v1' },
      permissions: {
        domains: ['127.0.0.1'],
        downloads: false,
        uploads: false,
        filesystem: [],
        requiresHumanLogin: false,
      },
      validation: {
        status: 'passed',
        validatedAt: new Date().toISOString(),
        consecutivePasses: 3,
        successRate30d: 1,
      },
      fingerprints: [],
      entrypoint: 'program',
      riskLevel: mode === 'read' ? 'low' : 'high',
      requiresApproval: mode === 'write',
      reversible: mode === 'read',
    },
    program,
  }));
}

async function createArtifact(
  root: string,
  mode: 'read' | 'write',
): Promise<ArtifactReference> {
  const content = bundle(mode);
  const reference = signArtifactReference({
    artifactId: `orders-${mode}`,
    tenantId: 'tenant-1',
    kind: 'capability',
    version: '1.0.0',
    sha256: createHash('sha256').update(content).digest('hex'),
    signingKeyId: 'test-key',
    contentLength: content.byteLength,
    transport: {
      type: 'local',
      path: `capability/orders-${mode}/1.0.0`,
    },
    compatibility,
    publishedAt: new Date().toISOString(),
  }, privateKey);
  const directory = path.join(
    root,
    'tenant-1',
    'capability',
    `orders-${mode}`,
    '1.0.0',
  );
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(path.join(directory, 'artifact.bin'), content);
  return reference;
}

async function createHarness(mode: 'read' | 'write') {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'smart-form-e2e-'));
  tempDirectories.push(directory);
  const artifactRoot = path.join(directory, 'artifacts');
  const database = await LocalDatabaseManager.open(path.join(directory, 'database'));
  const page = await browser.newPage();
  const reports: AgentReport[] = [];
  const reference = await createArtifact(artifactRoot, mode);
  const runner = new RunnerExecutorAdapter();
  const unavailableSidecar: AutomationExecutorAdapter = {
    kind: 'browser-use-sidecar',
    execute: async () => ({ status: 'failed', error: 'not used' }),
    pause: async () => undefined,
    drain: async () => undefined,
    cancel: async () => undefined,
  };
  const orchestrator = new DesktopTaskOrchestrator({
    tenantId: 'tenant-1',
    deviceId: 'device-1',
    protocolVersion: '1.0.0',
    page,
    database,
    artifactLoader: new ArtifactLoader({
      environment: {
        tenantId: 'tenant-1',
        deviceId: 'device-1',
        protocolVersion: '1.0.0',
        sdkVersion: '0.1.0',
        playwrightVersion: '1.50.0',
        nodeVersion: process.versions.node,
        browser: 'chromium',
        executionMode: 'cdp',
      },
      trustedSigningKeys: new Map([['test-key', publicKey]]),
      accessToken: 'not-used',
      localArtifactRoot: artifactRoot,
    }),
    control: new BrowserControlAuthority(),
    executors: new Map([
      ['playwright-runner', runner],
      ['browser-use-sidecar', unavailableSidecar],
    ]),
    frames: { start: () => undefined, stop: () => undefined },
    reports: {
      sendReport: async (report) => {
        reports.push(report);
      },
    },
    probeBrowser: async () => ({
      url: page.url(),
      title: await page.title(),
      activeTargetId: `page-${mode}`,
    }),
  });
  const taskDefinition = task(mode);
  const start: StartTaskCommand = {
    protocolVersion: '1.0.0',
    commandId: `start-${mode}`,
    taskId: taskDefinition.id,
    tenantId: 'tenant-1',
    deviceId: 'device-1',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    type: 'START_TASK',
    task: taskDefinition,
    capability: reference,
    resources: [],
  };
  return { database, orchestrator, page, reports, runner, start };
}

async function waitForReport(
  reports: AgentReport[],
  predicate: (report: AgentReport) => boolean,
): Promise<AgentReport> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const report = reports.find(predicate);
    if (report) return report;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for Desktop report');
}

describe.sequential('local read/write workflow', () => {
  it('executes a signed read capability in the Desktop-owned browser', async () => {
    const harness = await createHarness('read');
    await harness.orchestrator.handle(harness.start);
    const report = await waitForReport(
      harness.reports,
      (candidate) => candidate.type === 'TASK_EVENT' && candidate.payload.state === 'SUCCEEDED',
    );

    expect(report.payload.records).toEqual([
      { id: 'A-100', amount: '19.50' },
      { id: 'A-101', amount: '42.00' },
    ]);
    expect(harness.database.getCheckpoint('task-read')?.state).toBe('SUCCEEDED');
    await harness.page.close();
    await harness.database.close();
  });

  it('fills locally but cannot submit until an explicit approval command', async () => {
    submittedBody = '';
    const harness = await createHarness('write');
    await harness.orchestrator.handle(harness.start);
    const waiting = await waitForReport(
      harness.reports,
      (candidate) => (
        candidate.type === 'TASK_EVENT'
        && candidate.payload.state === 'WAITING_APPROVAL_SUBMIT'
      ),
    );

    expect(submittedBody).toBe('');
    const submissionId = String(waiting.payload.submissionId);
    const approve: AgentCommand = {
      protocolVersion: '1.0.0',
      commandId: 'approve-write',
      taskId: 'task-write',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      type: 'APPROVE_SUBMIT',
      submissionId,
    };
    await harness.orchestrator.handle(approve);
    await waitForReport(
      harness.reports,
      (candidate) => candidate.type === 'TASK_EVENT' && candidate.payload.state === 'SUCCEEDED',
    );

    expect(submittedBody).toBe('orderNumber=A-202');
    expect(harness.database.getCheckpoint('task-write')?.state).toBe('SUCCEEDED');
    await harness.page.close();
    await harness.database.close();
  });
});
