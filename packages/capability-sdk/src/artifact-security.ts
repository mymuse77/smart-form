import {
  createHash,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyLike,
} from 'node:crypto';
import semver from 'semver';
import {
  ArtifactReference,
  RuntimeCompatibility,
  type ArtifactRejectionCode,
  type ArtifactReference as ArtifactReferenceValue,
  type ExecutionEnvironment,
  type RuntimeCompatibility as RuntimeCompatibilityValue,
} from '@smart-form/contracts';

export interface ArtifactVerificationInput {
  reference: ArtifactReferenceValue;
  content: Buffer;
  environment: ExecutionEnvironment;
  compatibility?: RuntimeCompatibilityValue;
  trustedSigningKeys: ReadonlyMap<string, KeyLike>;
}

export type ArtifactVerificationResult =
  | { ok: true }
  | { ok: false; code: ArtifactRejectionCode; detail: string };

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * The signed payload intentionally excludes transport details so a short-lived
 * download URL can rotate without republishing the immutable artifact.
 */
export function createArtifactSignaturePayload(
  reference: Omit<ArtifactReferenceValue, 'signature' | 'transport'>,
): Buffer {
  return Buffer.from([
    reference.artifactId,
    reference.tenantId,
    reference.kind,
    reference.version,
    reference.sha256.toLowerCase(),
    String(reference.contentLength),
    reference.signingKeyId,
    reference.publishedAt,
    reference.compatibility
      ? JSON.stringify(reference.compatibility)
      : '',
  ].join('\n'), 'utf8');
}

export function signArtifactReference(
  unsignedReference: Omit<ArtifactReferenceValue, 'signature'>,
  privateKey: KeyLike,
): ArtifactReferenceValue {
  const parsed = ArtifactReference.omit({ signature: true }).parse(unsignedReference);
  const payload = createArtifactSignaturePayload({
    artifactId: parsed.artifactId,
    tenantId: parsed.tenantId,
    kind: parsed.kind,
    version: parsed.version,
    sha256: parsed.sha256,
    signingKeyId: parsed.signingKeyId,
    contentLength: parsed.contentLength,
    publishedAt: parsed.publishedAt,
    compatibility: parsed.compatibility,
  });
  const signature = cryptoSign(null, payload, privateKey).toString('base64');
  return ArtifactReference.parse({ ...parsed, signature });
}

function reject(
  code: ArtifactRejectionCode,
  detail: string,
): ArtifactVerificationResult {
  return { ok: false, code, detail };
}

function satisfies(version: string, range: string): boolean {
  return semver.valid(version) !== null
    && semver.validRange(range) !== null
    && semver.satisfies(version, range, { includePrerelease: true });
}

export function verifyRuntimeCompatibility(
  compatibilityInput: RuntimeCompatibilityValue,
  environment: ExecutionEnvironment,
): ArtifactVerificationResult {
  const compatibility = RuntimeCompatibility.parse(compatibilityInput);

  if (compatibility.protocolVersion !== environment.protocolVersion) {
    return reject(
      'PROTOCOL_INCOMPATIBLE',
      `Protocol ${environment.protocolVersion} does not match ${compatibility.protocolVersion}`,
    );
  }
  if (!satisfies(environment.sdkVersion, compatibility.sdkRange)) {
    return reject('SDK_INCOMPATIBLE', `SDK ${environment.sdkVersion} does not satisfy ${compatibility.sdkRange}`);
  }
  if (!satisfies(environment.playwrightVersion, compatibility.playwrightRange)) {
    return reject(
      'PLAYWRIGHT_INCOMPATIBLE',
      `Playwright ${environment.playwrightVersion} does not satisfy ${compatibility.playwrightRange}`,
    );
  }
  if (!satisfies(environment.nodeVersion, compatibility.nodeRange)) {
    return reject('NODE_INCOMPATIBLE', `Node ${environment.nodeVersion} does not satisfy ${compatibility.nodeRange}`);
  }
  if (compatibility.browser !== environment.browser) {
    return reject('BROWSER_INCOMPATIBLE', `Browser ${environment.browser} is not supported`);
  }
  if (!compatibility.executionModes.includes(environment.executionMode)) {
    return reject(
      'EXECUTION_MODE_INCOMPATIBLE',
      `Execution mode ${environment.executionMode} is not supported`,
    );
  }
  return { ok: true };
}

export function verifyArtifact(input: ArtifactVerificationInput): ArtifactVerificationResult {
  const reference = ArtifactReference.parse(input.reference);

  if (reference.tenantId !== input.environment.tenantId) {
    return reject(
      'TENANT_MISMATCH',
      `Artifact tenant ${reference.tenantId} does not match device tenant ${input.environment.tenantId}`,
    );
  }
  if (reference.contentLength !== input.content.byteLength) {
    return reject(
      'ARTIFACT_SIZE_MISMATCH',
      `Expected ${reference.contentLength} bytes but received ${input.content.byteLength}`,
    );
  }

  const actualHash = sha256(input.content);
  if (actualHash !== reference.sha256.toLowerCase()) {
    return reject('ARTIFACT_HASH_MISMATCH', `Expected ${reference.sha256} but received ${actualHash}`);
  }

  const publicKey = input.trustedSigningKeys.get(reference.signingKeyId);
  if (!publicKey) {
    return reject('ARTIFACT_SIGNING_KEY_UNKNOWN', `Unknown signing key ${reference.signingKeyId}`);
  }

  const payload = createArtifactSignaturePayload({
    artifactId: reference.artifactId,
    tenantId: reference.tenantId,
    kind: reference.kind,
    version: reference.version,
    sha256: reference.sha256,
    signingKeyId: reference.signingKeyId,
    contentLength: reference.contentLength,
    publishedAt: reference.publishedAt,
    compatibility: reference.compatibility,
  });
  const signature = Buffer.from(reference.signature, 'base64');
  if (!cryptoVerify(null, payload, publicKey, signature)) {
    return reject('ARTIFACT_SIGNATURE_INVALID', 'Artifact signature verification failed');
  }

  const compatibility = input.compatibility ?? reference.compatibility;
  if (!compatibility) {
    return reject(
      'ARTIFACT_MANIFEST_INVALID',
      'Artifact does not declare runtime compatibility',
    );
  }
  return verifyRuntimeCompatibility(compatibility, input.environment);
}
