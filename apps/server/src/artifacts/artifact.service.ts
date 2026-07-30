import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import {
  ManagedResourceKind,
  type ArtifactReference,
  type ManagedResourceKind as ManagedResourceKindValue,
  type RuntimeCompatibility,
} from '@smart-form/contracts';
import {
  signArtifactReference,
  validateCapabilityBundlePublication,
} from '@smart-form/capability-sdk';
import type { AppConfig } from '../shared/config';
import { ValidationError } from '../shared/app-error';
import type { ArtifactStore, StoredArtifact } from './artifact-store';

export interface PublishArtifactInput {
  tenantId: string;
  artifactId: string;
  kind: ManagedResourceKindValue;
  version: string;
  content: Buffer;
  compatibility?: RuntimeCompatibility;
}

export class ArtifactService {
  private readonly privateKey: KeyObject;

  constructor(
    private readonly store: ArtifactStore,
    private readonly config: AppConfig,
  ) {
    if (config.ARTIFACT_SIGNING_PRIVATE_KEY_B64) {
      this.privateKey = createPrivateKey(
        Buffer.from(config.ARTIFACT_SIGNING_PRIVATE_KEY_B64, 'base64'),
      );
    } else {
      this.privateKey = generateKeyPairSync('ed25519').privateKey;
    }
  }

  async publish(input: PublishArtifactInput): Promise<ArtifactReference> {
    const kind = ManagedResourceKind.parse(input.kind);
    if (kind === 'capability' && !input.compatibility) {
      throw new ValidationError('Capability artifacts must declare runtime compatibility');
    }
    if (kind === 'capability' && input.compatibility) {
      try {
        validateCapabilityBundlePublication(input.content, {
          artifactId: input.artifactId,
          tenantId: input.tenantId,
          version: input.version,
          compatibility: input.compatibility,
        });
      } catch (error: unknown) {
        throw new ValidationError(
          `Capability artifact validation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const sha256 = createHash('sha256').update(input.content).digest('hex');
    const encodedArtifactId = encodeURIComponent(input.artifactId);
    const encodedVersion = encodeURIComponent(input.version);
    const artifactPublicBaseUrl = this.config.ARTIFACT_PUBLIC_BASE_URL?.replace(/\/+$/, '');
    const transport = this.config.ARTIFACT_TRANSPORT === 'https'
      ? {
        type: 'https' as const,
        url: `${artifactPublicBaseUrl}/v1/artifacts/${kind}/${encodedArtifactId}/versions/${encodedVersion}`,
      }
      : {
        type: 'local' as const,
        path: `${kind}/${input.artifactId}/${input.version}`,
      };
    const reference = signArtifactReference({
      artifactId: input.artifactId,
      tenantId: input.tenantId,
      kind,
      version: input.version,
      sha256,
      signingKeyId: this.config.ARTIFACT_SIGNING_KEY_ID,
      contentLength: input.content.byteLength,
      transport,
      compatibility: input.compatibility,
      publishedAt: new Date().toISOString(),
    }, this.privateKey);
    await this.store.put(reference, input.content);
    return reference;
  }

  getCurrentSigningKey(): {
    keyId: string;
    algorithm: 'Ed25519';
    publicKeyPem: string;
  } {
    return {
      keyId: this.config.ARTIFACT_SIGNING_KEY_ID,
      algorithm: 'Ed25519',
      publicKeyPem: createPublicKey(this.privateKey).export({
        format: 'pem',
        type: 'spki',
      }).toString(),
    };
  }

  get(
    tenantId: string,
    kind: ManagedResourceKindValue,
    artifactId: string,
    version: string,
  ): Promise<StoredArtifact> {
    return this.store.get(tenantId, kind, artifactId, version);
  }
}
