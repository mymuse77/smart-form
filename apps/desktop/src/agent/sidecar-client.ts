import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as readline from 'node:readline';
import {
  SidecarRequest,
  SidecarResponse,
  type SidecarResponse as SidecarResponseValue,
} from '@smart-form/contracts';

const PROTOCOL_VERSION = '1.0.0' as const;

export interface SidecarProcessConfig {
  executable: string;
  args: string[];
  cwd: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  onDiagnostic?: (message: string) => void;
}

interface PendingRequest {
  resolve: (response: SidecarResponseValue) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface PendingExecution {
  resolve: (response: SidecarResponseValue) => void;
  reject: (error: Error) => void;
}

export function buildSidecarEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowedExact = new Set([
    'PATH',
    'Path',
    'SYSTEMROOT',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'OPENAI_API_KEY',
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => (
      value !== undefined
      && (allowedExact.has(key) || key.startsWith('BROWSER_USE_'))
    )),
  );
}

export class SidecarProcessClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly executions = new Map<string, PendingExecution>();
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly config: SidecarProcessConfig) {}

  start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const child = spawn(this.config.executable, this.config.args, {
        cwd: this.config.cwd,
        env: buildSidecarEnvironment(this.config.environment ?? process.env),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.process = child;
      const timeout = setTimeout(() => {
        reject(new Error('Sidecar did not become ready before the startup timeout'));
        this.stop();
      }, this.config.startupTimeoutMs ?? 20_000);
      timeout.unref();

      const lines = readline.createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        try {
          const response = SidecarResponse.parse(JSON.parse(line));
          if (response.type === 'ready') {
            clearTimeout(timeout);
            resolve();
            return;
          }
          this.routeResponse(response);
        } catch (error) {
          this.failAll(new Error(
            `Sidecar emitted an invalid protocol message: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ));
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        this.config.onDiagnostic?.(chunk.toString('utf8').trim());
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
        this.failAll(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        const error = new Error(`Sidecar exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`);
        reject(error);
        this.failAll(error);
        this.process = null;
        this.readyPromise = null;
      });
    });
    return this.readyPromise;
  }

  async execute(input: {
    taskId: string;
    cdpEndpoint: string;
    targetId: string;
    prompt: string;
    allowedDomains: string[];
    maxSteps: number;
  }): Promise<SidecarResponseValue> {
    await this.start();
    if (this.executions.has(input.taskId)) {
      throw new Error(`Sidecar task already exists: ${input.taskId}`);
    }
    const requestId = randomUUID();
    const result = new Promise<SidecarResponseValue>((resolve, reject) => {
      this.executions.set(input.taskId, { resolve, reject });
    });
    try {
      await this.request({
        protocol_version: PROTOCOL_VERSION,
        type: 'execute',
        request_id: requestId,
        task_id: input.taskId,
        cdp_endpoint: input.cdpEndpoint,
        target_id: input.targetId,
        prompt: input.prompt,
        allowed_domains: input.allowedDomains,
        max_steps: input.maxSteps,
      });
      return await result;
    } catch (error) {
      this.executions.delete(input.taskId);
      throw error;
    }
  }

  async control(type: 'pause' | 'resume' | 'cancel', taskId: string): Promise<void> {
    await this.start();
    await this.request({
      protocol_version: PROTOCOL_VERSION,
      type,
      request_id: randomUUID(),
      task_id: taskId,
    });
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;
    await this.request({
      protocol_version: PROTOCOL_VERSION,
      type: 'shutdown',
      request_id: randomUUID(),
    }).catch(() => undefined);
    this.stop();
  }

  stop(): void {
    const child = this.process;
    this.process = null;
    this.readyPromise = null;
    if (child && !child.killed) child.kill();
    this.failAll(new Error('Sidecar client stopped'));
  }

  private request(requestInput: SidecarRequest): Promise<SidecarResponseValue> {
    const request = SidecarRequest.parse(requestInput);
    const child = this.process;
    if (!child || !child.stdin.writable) {
      return Promise.reject(new Error('Sidecar process is not writable'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.request_id);
        reject(new Error(`Sidecar request timed out: ${request.type}`));
      }, this.config.requestTimeoutMs ?? 35_000);
      timer.unref();
      this.pending.set(request.request_id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(request.request_id);
        reject(error);
      });
    });
  }

  private routeResponse(response: SidecarResponseValue): void {
    if (response.type === 'result' && response.task_id) {
      const execution = this.executions.get(response.task_id);
      if (execution) {
        this.executions.delete(response.task_id);
        execution.resolve(response);
      }
      return;
    }
    if (!response.request_id) return;
    const pending = this.pending.get(response.request_id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.request_id);
    if (response.type === 'error') {
      pending.reject(new Error(String(response.payload.detail ?? response.status ?? 'Sidecar error')));
    } else {
      pending.resolve(response);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const execution of this.executions.values()) execution.reject(error);
    this.executions.clear();
  }
}

