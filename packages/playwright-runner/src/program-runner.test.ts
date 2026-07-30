import { describe, expect, it, vi } from 'vitest';
import type { CapabilityArtifactBundle, TaskDefinition } from '@smart-form/contracts';
import type { Locator, Page } from 'playwright';
import { DeclarativeCapabilityRunner } from './program-runner';

function task(mode: 'read' | 'write'): TaskDefinition {
  return {
    id: 'task-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    title: 'Orders',
    description: '',
    taskType: mode === 'read' ? 'collect' : 'fill',
    mode,
    site: { entryUrl: 'https://forms.example.com', allowedDomains: ['forms.example.com'] },
    target: { entity: 'order', fields: [] },
    ...(mode === 'write' ? { input: { values: { name: 'Alice' } } } : {}),
    output: { format: 'jsonl', destination: 'local' },
    budget: {
      maxSteps: 100,
      stepTimeoutMs: 30_000,
      totalTimeoutMs: 1_800_000,
      maxCostUsd: 1,
    },
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

function bundle(program: CapabilityArtifactBundle['program']): CapabilityArtifactBundle {
  return { format: 'smart-form-capability-v1', manifest: {} as never, program };
}

function pageFixture() {
  const elements = new Map<string, {
    text?: string;
    value?: string;
    clicked?: number;
  }>([
    ['.id', { text: 'A-1' }],
    ['#name', {}],
    ['#commit-order', {}],
  ]);
  const locator = (selector: string): Locator => {
    const element = elements.get(selector) ?? {};
    elements.set(selector, element);
    const value = {
      first: () => value,
      nth: () => value,
      locator,
      count: vi.fn(async () => 1),
      textContent: vi.fn(async () => element.text ?? null),
      inputValue: vi.fn(async () => element.value ?? ''),
      getAttribute: vi.fn(async () => null),
      fill: vi.fn(async (input: string) => { element.value = input; }),
      selectOption: vi.fn(async () => []),
      press: vi.fn(async () => undefined),
      waitFor: vi.fn(async () => undefined),
      click: vi.fn(async () => { element.clicked = (element.clicked ?? 0) + 1; }),
    };
    return value as unknown as Locator;
  };
  const page = {
    url: vi.fn(() => 'https://forms.example.com/orders'),
    goto: vi.fn(async () => null),
    locator,
  } as unknown as Page;
  return { elements, page };
}

describe('DeclarativeCapabilityRunner', () => {
  it('extracts records through the restricted program API', async () => {
    const { page } = pageFixture();
    const result = await DeclarativeCapabilityRunner.execute(bundle([{
      type: 'extract',
      maxRecords: 10,
      fields: [{ name: 'id', selector: '.id', read: 'text' }],
    }]), page, task('read'), { request: vi.fn() });

    expect(result.data).toEqual([{ id: 'A-1' }]);
  });

  it('waits for explicit approval before the only commit primitive clicks', async () => {
    const { elements, page } = pageFixture();
    const approval = vi.fn(async () => true);
    await DeclarativeCapabilityRunner.execute(bundle([
      {
        type: 'fill',
        selector: '#name',
        value: { source: 'input', key: 'name' },
      },
      {
        type: 'submit',
        selector: '#commit-order',
        snapshotKeys: ['name'],
      },
    ]), page, task('write'), { request: approval });

    expect(approval).toHaveBeenCalledWith(expect.objectContaining({
      formDataSnapshot: { name: 'Alice' },
    }));
    expect(elements.get('#commit-order')?.clicked).toBe(1);
  });

  it('does not click when approval is rejected', async () => {
    const { elements, page } = pageFixture();
    await expect(DeclarativeCapabilityRunner.execute(bundle([{
      type: 'submit',
      selector: '#commit-order',
      snapshotKeys: [],
    }]), page, task('write'), { request: vi.fn(async () => false) }))
      .rejects.toThrow('Submission was rejected');

    expect(elements.get('#commit-order')?.clicked).toBeUndefined();
  });

  it('executes the remaining bounded navigation and input primitives', async () => {
    const { page } = pageFixture();
    const result = await DeclarativeCapabilityRunner.execute(bundle([
      { type: 'navigate', url: 'https://forms.example.com/next' },
      { type: 'click', selector: '#next' },
      {
        type: 'select',
        selector: '#status',
        value: { source: 'literal', value: 'open' },
      },
      { type: 'press', selector: '#name', key: 'Tab' },
      { type: 'waitFor', selector: '#ready', state: 'visible' },
      {
        type: 'extract',
        maxRecords: 1,
        fields: [
          { name: 'value', selector: '#name', read: 'value' },
          { name: 'kind', selector: '#name', read: 'attribute', attribute: 'data-kind' },
        ],
      },
    ]), page, task('write'), { request: vi.fn() });

    expect(page.goto).toHaveBeenCalledWith(
      'https://forms.example.com/next',
      { waitUntil: 'domcontentloaded' },
    );
    expect(result.data).toEqual([{ value: '', kind: null }]);
  });

  it('fails closed for missing inputs and out-of-domain navigation', async () => {
    const { page } = pageFixture();
    await expect(DeclarativeCapabilityRunner.execute(bundle([{
      type: 'fill',
      selector: '#name',
      value: { source: 'input', key: 'missing' },
    }]), page, task('write'), { request: vi.fn() })).rejects.toThrow('input is missing');

    await expect(DeclarativeCapabilityRunner.execute(bundle([{
      type: 'navigate',
      url: 'https://attacker.example.net/',
    }]), page, task('read'), { request: vi.fn() })).rejects.toThrow('outside');
  });
});
