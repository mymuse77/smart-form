import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KeyLike } from 'node:crypto';
import {
  ArtifactReference,
  type ArtifactReference as ArtifactReferenceValue,
  type ArtifactRejectionCode,
  type ExecutionEnvironment,
} from '@smart-form/contracts';
import { verifyArtifact } from '@smart-form/capability-sdk';

export interface ArtifactLoaderConfig {
  environment: ExecutionEnvironment;
  trustedSigningKeys: ReadonlyMap<string, KeyLike>;
  accessToken: string;
  localArtifactRoot?: string;
  allowedHttpsOrigins?: readonly string[];
  maxArtifactBytes?: number;
}

export class ArtifactRejectedError extends Error {
  constructor(
    public readonly code: ArtifactRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactRejectedError';
  }
}

export class ArtifactLoader {
  constructor(private readonly config: ArtifactLoaderConfig) {}

  async load(referenceInput: ArtifactReferenceValue): Promise<Buffer> {
    const reference = ArtifactReference.parse(referenceInput);
    const maxBytes = this.config.maxArtifactBytes ?? 20 * 1024 * 1024;
    if (reference.contentLength > maxBytes) {
      throw new ArtifactRejectedError(
        'ARTIFACT_SIZE_MISMATCH',
        `Artifact exceeds the ${maxBytes} byte device limit`,
      );
    }
    const content = reference.transport.type === 'https'
      ? await this.downloadHttps(reference.transport.url, maxBytes)
      : await this.readLocal(reference);
    const result = verifyArtifact({
      reference,
      content,
      environment: this.config.environment,
      trustedSigningKeys: this.config.trustedSigningKeys,
    });
    if (!result.ok) throw new ArtifactRejectedError(result.code, result.detail);
    return content;
  }

  private async downloadHttps(
    artifactUrl: string,
    maxBytes: number,
  ): Promise<Buffer> {
    const url = new URL(artifactUrl);
    const allowedOrigins = this.config.allowedHttpsOrigins ?? [];
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) {
      throw new ArtifactRejectedError(
        'PERMISSION_DENIED',
        `Artifact origin is not allowlisted: ${url.origin}`,
      );
    }
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.config.accessToken}` },
      redirect: 'error',
    });
    if (!response.ok) {
      throw new ArtifactRejectedError(
        'ARTIFACT_NOT_FOUND',
        `Artifact download failed with HTTP ${response.status}`,
      );
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > maxBytes) {
      throw new ArtifactRejectedError('ARTIFACT_SIZE_MISMATCH', 'Artifact response is too large');
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async readLocal(reference: ArtifactReferenceValue): Promise<Buffer> {
    if (!this.config.localArtifactRoot || reference.transport.type !== 'local') {
      throw new ArtifactRejectedError(
        'PERMISSION_DENIED',
        'Local artifact transport is disabled',
      );
    }
    const root = path.resolve(this.config.localArtifactRoot);
    const artifactPath = path.resolve(
      root,
      reference.tenantId,
      reference.transport.path,
      'artifact.bin',
    );
    if (!artifactPath.startsWith(`${root}${path.sep}`)) {
      throw new ArtifactRejectedError('PERMISSION_DENIED', 'Artifact path escaped its root');
    }
    try {
      return await fs.promises.readFile(artifactPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ArtifactRejectedError('ARTIFACT_NOT_FOUND', 'Local artifact was not found');
      }
      throw error;
    }
  }
}
