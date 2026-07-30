import { describe, expect, it, vi } from 'vitest';
import {
  BrowserControlAuthority,
  ControlLeaseConflictError,
} from './control-lease';

describe('BrowserControlAuthority', () => {
  it('allows only one automation executor at a time', () => {
    const authority = new BrowserControlAuthority();
    authority.acquire('task-1', 'playwright-runner');

    expect(() => authority.acquire('task-1', 'browser-use-sidecar'))
      .toThrow(ControlLeaseConflictError);
  });

  it('drains in-flight work before transferring to a human', async () => {
    const authority = new BrowserControlAuthority();
    const automation = authority.acquire('task-1', 'browser-use-sidecar');
    const drain = vi.fn(async () => undefined);

    const human = await authority.transferToHuman(automation.token, drain);

    expect(drain).toHaveBeenCalledOnce();
    expect(human.holder).toBe('human');
    expect(human.epoch).toBeGreaterThan(automation.epoch);
  });

  it('re-probes and rejects resume after a cross-domain redirect', async () => {
    const authority = new BrowserControlAuthority();
    const automation = authority.acquire('task-1', 'playwright-runner');
    const human = await authority.transferToHuman(automation.token, async () => undefined);

    expect(() => authority.resumeAfterHuman(
      human.token,
      'playwright-runner',
      { url: 'https://example.com/login', activeTargetId: 'page-1' },
      { url: 'https://evil.example/login', activeTargetId: 'page-1' },
      ['example.com'],
    )).toThrow(/allowed domains/);
  });

  it('does not widen an exact domain policy to subdomains on resume', async () => {
    const authority = new BrowserControlAuthority();
    const automation = authority.acquire('task-1', 'playwright-runner');
    const human = await authority.transferToHuman(automation.token, async () => undefined);

    expect(() => authority.resumeAfterHuman(
      human.token,
      'playwright-runner',
      { url: 'https://forms.example.com/start', activeTargetId: 'target-1' },
      { url: 'https://evil.forms.example.com/resume', activeTargetId: 'target-1' },
      ['forms.example.com'],
    )).toThrow(/allowed domains/);
  });

  it('issues a new automation lease after a valid human resume', async () => {
    const authority = new BrowserControlAuthority();
    const automation = authority.acquire('task-1', 'playwright-runner');
    const human = await authority.transferToHuman(automation.token, async () => undefined);

    const resumed = authority.resumeAfterHuman(
      human.token,
      'playwright-runner',
      { url: 'https://example.com/login', activeTargetId: 'page-1' },
      { url: 'https://example.com/orders', activeTargetId: 'page-1' },
      ['example.com'],
    );

    expect(resumed.holder).toBe('playwright-runner');
    expect(resumed.token).not.toBe(automation.token);
  });
});
