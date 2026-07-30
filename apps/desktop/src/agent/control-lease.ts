import { randomUUID } from 'node:crypto';

export type AutomationExecutor = 'playwright-runner' | 'browser-use-sidecar';
export type ControlHolder = AutomationExecutor | 'human';

export interface ControlLease {
  taskId: string;
  holder: ControlHolder;
  token: string;
  epoch: number;
  acquiredAt: number;
}

export interface BrowserProbe {
  url: string;
  title?: string;
  fingerprint?: string;
  activeTargetId?: string;
}

export class ControlLeaseConflictError extends Error {
  constructor(public readonly activeLease: ControlLease) {
    super(`Browser control is held by ${activeLease.holder}`);
    this.name = 'ControlLeaseConflictError';
  }
}

export class BrowserControlAuthority {
  private lease: ControlLease | null = null;
  private epoch = 0;

  current(): ControlLease | null {
    return this.lease ? { ...this.lease } : null;
  }

  acquire(taskId: string, holder: AutomationExecutor): ControlLease {
    if (this.lease) throw new ControlLeaseConflictError(this.current()!);
    this.lease = this.createLease(taskId, holder);
    return this.current()!;
  }

  assert(token: string, holder: ControlHolder): void {
    if (!this.lease || this.lease.token !== token || this.lease.holder !== holder) {
      throw new Error('Browser control lease is missing, stale, or owned by another executor');
    }
  }

  async transferToHuman(
    automationToken: string,
    drainInFlightAction: () => Promise<void>,
  ): Promise<ControlLease> {
    if (!this.lease || this.lease.token !== automationToken || this.lease.holder === 'human') {
      throw new Error('Only the active automation executor can transfer control');
    }
    const taskId = this.lease.taskId;
    await drainInFlightAction();
    this.lease = this.createLease(taskId, 'human');
    return this.current()!;
  }

  resumeAfterHuman(
    humanToken: string,
    holder: AutomationExecutor,
    expected: BrowserProbe,
    actual: BrowserProbe,
    allowedDomains: readonly string[],
  ): ControlLease {
    this.assert(humanToken, 'human');
    const hostname = new URL(actual.url).hostname.toLowerCase();
    const allowed = allowedDomains.some((domain) => hostname === domain.toLowerCase());
    if (!allowed) throw new Error(`Cannot resume outside allowed domains: ${hostname}`);
    if (
      expected.activeTargetId
      && actual.activeTargetId
      && expected.activeTargetId !== actual.activeTargetId
    ) {
      throw new Error('Active browser target changed during human control');
    }
    this.lease = this.createLease(this.lease!.taskId, holder);
    return this.current()!;
  }

  release(token: string): void {
    if (!this.lease || this.lease.token !== token) {
      throw new Error('Cannot release a stale browser control lease');
    }
    this.lease = null;
  }

  private createLease(taskId: string, holder: ControlHolder): ControlLease {
    this.epoch += 1;
    return {
      taskId,
      holder,
      token: randomUUID(),
      epoch: this.epoch,
      acquiredAt: Date.now(),
    };
  }
}
