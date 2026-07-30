import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  ArtifactReference,
  ExecutionEnvironment,
  RuntimeCompatibility,
} from '@smart-form/contracts';
import {
  signArtifactReference,
  signDeviceValidationEvidence,
  verifyArtifact,
  verifyDeviceValidationEvidence,
} from './index.js';

const timestamp = '2026-07-31T00:00:00.000Z';
const content = Buffer.from('export const capability = true;', 'utf8');
const digest = createHash('sha256').update(content).digest('hex');
const serverKeys = generateKeyPairSync('ed25519');
const deviceKeys = generateKeyPairSync('ed25519');

const environment: ExecutionEnvironment = {
  tenantId: 'tenant-1',
  deviceId: 'device-1',
  protocolVersion: '1.0.0',
  sdkVersion: '1.4.0',
  playwrightVersion: '1.50.1',
  nodeVersion: '22.17.0',
  browser: 'chromium',
  executionMode: 'cdp',
};

const compatibility: RuntimeCompatibility = {
  protocolVersion: '1.0.0',
  sdkRange: '^1.3.0',
  playwrightRange: '^1.50.0',
  nodeRange: '>=20.0.0',
  browser: 'chromium',
  executionModes: ['cdp'],
};

function createReference(): ArtifactReference {
  return signArtifactReference({
    artifactId: 'capability-1',
    tenantId: 'tenant-1',
    kind: 'capability',
    version: '1.2.3',
    sha256: digest,
    signingKeyId: 'server-key-1',
    contentLength: content.byteLength,
    transport: { type: 'local', path: 'fixtures/capability.js' },
    publishedAt: timestamp,
  }, serverKeys.privateKey);
}

function verify(reference: ArtifactReference, artifactContent = content) {
  return verifyArtifact({
    reference,
    content: artifactContent,
    environment,
    compatibility,
    trustedSigningKeys: new Map([['server-key-1', serverKeys.publicKey]]),
  });
}

describe('artifact security', () => {
  it('accepts an authentic, compatible artifact', () => {
    expect(verify(createReference())).toEqual({ ok: true });
  });

  it('rejects tampered artifact bytes', () => {
    expect(verify(createReference(), Buffer.from('tampered'))).toMatchObject({
      ok: false,
      code: 'ARTIFACT_SIZE_MISMATCH',
    });
  });

  it('rejects an invalid server signature', () => {
    const reference = createReference();
    const forged = {
      ...reference,
      signature: Buffer.from('forged').toString('base64'),
    };
    expect(verify(forged)).toMatchObject({
      ok: false,
      code: 'ARTIFACT_SIGNATURE_INVALID',
    });
  });

  it('rejects incompatible runtime versions', () => {
    const result = verifyArtifact({
      reference: createReference(),
      content,
      environment: { ...environment, sdkVersion: '2.0.0' },
      compatibility,
      trustedSigningKeys: new Map([['server-key-1', serverKeys.publicKey]]),
    });
    expect(result).toMatchObject({ ok: false, code: 'SDK_INCOMPATIBLE' });
  });

  it('keeps device evidence signing separate from device authentication', () => {
    const evidence = signDeviceValidationEvidence({
      evidenceId: 'evidence-1',
      tenantId: 'tenant-1',
      deviceId: 'device-1',
      taskId: 'task-1',
      artifactId: 'capability-1',
      artifactVersion: '1.2.3',
      resultHash: 'c'.repeat(64),
      createdAt: timestamp,
      signingKeyId: 'device-key-1',
    }, deviceKeys.privateKey);

    expect(verifyDeviceValidationEvidence(evidence, deviceKeys.publicKey)).toBe(true);
    expect(verifyDeviceValidationEvidence(
      { ...evidence, taskId: 'other-task' },
      deviceKeys.publicKey,
    )).toBe(false);
  });
});
