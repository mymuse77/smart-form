import { describe, expect, it } from 'vitest';
import type { ArtifactReference, TaskDefinition } from '@smart-form/contracts';
import { parseAndValidateCapabilityBundle } from './capability-bundle';

const compatibility = {
  protocolVersion: '1.0.0',
  sdkRange: '^1.0.0',
  playwrightRange: '^1.50.0',
  nodeRange: '>=20',
  browser: 'chromium' as const,
  executionModes: ['cdp' as const],
};

function task(mode: 'read' | 'write'): TaskDefinition {
  return {
    id: 'task-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    title: 'Orders',
    description: '',
    taskType: mode === 'read' ? 'collect' : 'fill',
    mode,
    site: { entryUrl: 'https://forms.example.com/orders', allowedDomains: ['forms.example.com'] },
    target: { entity: 'order', fields: [] },
    ...(mode === 'write' ? { input: { values: { orderNumber: 'A-1' } } } : {}),
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

function reference(): ArtifactReference {
  return {
    artifactId: 'orders',
    tenantId: 'tenant-1',
    kind: 'capability',
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    signature: 'signature',
    signingKeyId: 'key-1',
    contentLength: 1,
    transport: { type: 'local', path: 'capability/orders/1.0.0' },
    compatibility,
    publishedAt: '2026-07-31T00:00:00.000Z',
  };
}

function bundle(mode: 'read' | 'write', program: unknown[]) {
  return Buffer.from(JSON.stringify({
    format: 'smart-form-capability-v1',
    manifest: {
      schemaVersion: '1.1',
      capabilityId: 'orders',
      version: '1.0.0',
      tenantId: 'tenant-1',
      name: 'Orders',
      taskType: mode === 'read' ? 'collect' : 'fill',
      mode,
      site: {
        domains: ['forms.example.com'],
        entryUrlPatterns: ['https://forms.example.com/*'],
        module: 'orders',
      },
      runtime: { ...compatibility, language: 'declarative-v1' },
      permissions: {
        domains: ['forms.example.com'],
        downloads: false,
        uploads: false,
        filesystem: [],
        requiresHumanLogin: false,
      },
      validation: {
        status: 'passed',
        validatedAt: '2026-07-31T00:00:00.000Z',
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

type MutableTestBundle = {
  manifest: {
    capabilityId: string;
    entrypoint: string;
    requiresApproval: boolean;
    validation: { status: string };
    permissions: { domains: string[] };
    runtime: { sdkRange: string };
    site: { domains: string[] };
  };
};

function mutateBundle(
  content: Buffer,
  mutate: (value: MutableTestBundle) => void,
): Buffer {
  const value = JSON.parse(content.toString('utf8')) as MutableTestBundle;
  mutate(value);
  return Buffer.from(JSON.stringify(value));
}

describe('capability bundle policy', () => {
  it('accepts a validated read extraction program', () => {
    const result = parseAndValidateCapabilityBundle(bundle('read', [{
      type: 'extract',
      fields: [{ name: 'id', selector: '.id', read: 'text' }],
    }]), reference(), task('read'));

    expect(result.program).toHaveLength(1);
  });

  it('rejects write operations inside a read capability', () => {
    expect(() => parseAndValidateCapabilityBundle(bundle('read', [{
      type: 'fill',
      selector: '#name',
      value: { source: 'literal', value: 'x' },
    }]), reference(), task('read'))).toThrow('write step');
  });

  it('rejects commit-like clicks that bypass the submit approval primitive', () => {
    expect(() => parseAndValidateCapabilityBundle(bundle('write', [{
      type: 'click',
      selector: '#submit-order',
    }]), reference(), task('write'))).toThrow('approved submit step');
  });

  it('rejects malformed and publication-inconsistent bundles', () => {
    expect(() => parseAndValidateCapabilityBundle(
      Buffer.from('not json'),
      reference(),
      task('read'),
    )).toThrow('valid UTF-8 JSON');
    expect(() => parseAndValidateCapabilityBundle(mutateBundle(bundle('read', [{
      type: 'waitFor',
      selector: 'body',
    }]), (value) => {
      value.manifest.capabilityId = 'other';
    }), reference(), task('read'))).toThrow('identity');
    expect(() => parseAndValidateCapabilityBundle(mutateBundle(bundle('read', [{
      type: 'waitFor',
      selector: 'body',
    }]), (value) => {
      value.manifest.validation.status = 'pending';
    }), reference(), task('read'))).toThrow('passed validation');
    expect(() => parseAndValidateCapabilityBundle(mutateBundle(bundle('read', [{
      type: 'waitFor',
      selector: 'body',
    }]), (value) => {
      value.manifest.entrypoint = 'other';
    }), reference(), task('read'))).toThrow('program entrypoint');
  });

  it('rejects permission, runtime, task, and navigation scope mismatches', () => {
    const base = bundle('read', [{ type: 'waitFor', selector: 'body' }]);
    expect(() => parseAndValidateCapabilityBundle(mutateBundle(base, (value) => {
      value.manifest.permissions.domains = ['attacker.example.net'];
    }), reference(), task('read'))).toThrow('declared sites');
    expect(() => parseAndValidateCapabilityBundle(mutateBundle(base, (value) => {
      value.manifest.runtime.sdkRange = '>=99';
    }), reference(), task('read'))).toThrow('runtime');
    expect(() => parseAndValidateCapabilityBundle(
      base,
      reference(),
      { ...task('read'), tenantId: 'tenant-2' },
    )).toThrow('task tenant');
    expect(() => parseAndValidateCapabilityBundle(
      base,
      reference(),
      task('write'),
    )).toThrow('mode');
    expect(() => parseAndValidateCapabilityBundle(mutateBundle(base, (value) => {
      value.manifest.site.domains = ['attacker.example.net'];
      value.manifest.permissions.domains = ['attacker.example.net'];
    }), reference(), task('read'))).toThrow('task scope');
    expect(() => parseAndValidateCapabilityBundle(bundle('read', [{
      type: 'navigate',
      url: 'https://attacker.example.net/',
    }]), reference(), task('read'))).toThrow('navigation');
  });

  it('requires high-risk approval metadata for submit programs', () => {
    const content = mutateBundle(bundle('write', [{
      type: 'submit',
      selector: '#commit-order',
      snapshotKeys: [],
    }]), (value) => {
      value.manifest.requiresApproval = false;
    });

    expect(() => parseAndValidateCapabilityBundle(content, reference(), task('write')))
      .toThrow('high-risk write capability');
  });
});
