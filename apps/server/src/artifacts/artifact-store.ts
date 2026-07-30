import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ArtifactReference,
  type ArtifactReference as ArtifactReferenceValue,
  type ManagedResourceKind,
} from '@smart-form/contracts';
import { ConflictError, NotFoundError } from '../shared/app-error';

export interface StoredArtifact {
  reference: ArtifactReferenceValue;
  content: Buffer;
}

export interface ArtifactStore {
  put(reference: ArtifactReferenceValue, content: Buffer): Promise<void>;
  get(
    tenantId: string,
    kind: ManagedResourceKind,
    artifactId: string,
    version: string,
  ): Promise<StoredArtifact>;
}

function safeSegment(label: string, value: string): string {
  if (!/^[a-zA-Z0-9_.-]{1,160}$/.test(value) || value.includes('..')) {
    throw new Error(`${label} contains unsafe path characters`);
  }
  return value;
}

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly rootDirectory: string) {}

  async put(referenceInput: ArtifactReferenceValue, content: Buffer): Promise<void> {
    const reference = ArtifactReference.parse(referenceInput);
    const directory = this.directoryFor(
      reference.tenantId,
      reference.kind,
      reference.artifactId,
      reference.version,
    );
    const contentPath = path.join(directory, 'artifact.bin');
    const metadataPath = path.join(directory, 'reference.json');
    if (await fs.promises.stat(metadataPath).then(() => true).catch(() => false)) {
      throw new ConflictError('Artifact versions are immutable', {
        artifactId: reference.artifactId,
        version: reference.version,
      });
    }
    await fs.promises.mkdir(directory, { recursive: true });
    await this.writeImmutable(contentPath, content);
    try {
      await this.writeImmutable(
        metadataPath,
        Buffer.from(JSON.stringify(reference), 'utf8'),
      );
    } catch (error) {
      await fs.promises.rm(contentPath, { force: true });
      throw error;
    }
  }

  async get(
    tenantId: string,
    kind: ManagedResourceKind,
    artifactId: string,
    version: string,
  ): Promise<StoredArtifact> {
    const directory = this.directoryFor(tenantId, kind, artifactId, version);
    try {
      const [metadata, content] = await Promise.all([
        fs.promises.readFile(path.join(directory, 'reference.json'), 'utf8'),
        fs.promises.readFile(path.join(directory, 'artifact.bin')),
      ]);
      const reference = ArtifactReference.parse(JSON.parse(metadata));
      if (reference.tenantId !== tenantId || reference.kind !== kind) {
        throw new NotFoundError('artifact', `${artifactId}@${version}`);
      }
      return { reference, content };
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new NotFoundError('artifact', `${artifactId}@${version}`);
      }
      throw error;
    }
  }

  private directoryFor(
    tenantId: string,
    kind: ManagedResourceKind,
    artifactId: string,
    version: string,
  ): string {
    return path.resolve(
      this.rootDirectory,
      safeSegment('tenantId', tenantId),
      safeSegment('kind', kind),
      safeSegment('artifactId', artifactId),
      safeSegment('version', version),
    );
  }

  private async writeImmutable(target: string, content: Buffer): Promise<void> {
    const temporary = `${target}.${randomUUID()}.tmp`;
    await fs.promises.writeFile(temporary, content, { flag: 'wx' });
    try {
      await fs.promises.link(temporary, target);
      await fs.promises.rm(temporary, { force: true });
    } catch (error) {
      await fs.promises.rm(temporary, { force: true });
      throw error;
    }
  }
}
