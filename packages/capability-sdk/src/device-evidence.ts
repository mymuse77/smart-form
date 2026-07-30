import { sign as cryptoSign, verify as cryptoVerify, type KeyLike } from 'node:crypto';
import {
  DeviceValidationEvidence,
  type DeviceValidationEvidence as DeviceValidationEvidenceValue,
} from '@smart-form/contracts';

type UnsignedEvidence = Omit<DeviceValidationEvidenceValue, 'signature'>;

export function createDeviceEvidenceSignaturePayload(evidence: UnsignedEvidence): Buffer {
  return Buffer.from([
    evidence.evidenceId,
    evidence.tenantId,
    evidence.deviceId,
    evidence.taskId,
    evidence.artifactId,
    evidence.artifactVersion,
    evidence.resultHash.toLowerCase(),
    evidence.createdAt,
    evidence.signingKeyId,
  ].join('\n'), 'utf8');
}

export function signDeviceValidationEvidence(
  evidence: UnsignedEvidence,
  privateKey: KeyLike,
): DeviceValidationEvidenceValue {
  const parsed = DeviceValidationEvidence.omit({ signature: true }).parse(evidence);
  const signature = cryptoSign(
    null,
    createDeviceEvidenceSignaturePayload(parsed),
    privateKey,
  ).toString('base64');
  return DeviceValidationEvidence.parse({ ...parsed, signature });
}

export function verifyDeviceValidationEvidence(
  evidenceInput: DeviceValidationEvidenceValue,
  publicKey: KeyLike,
): boolean {
  const evidence = DeviceValidationEvidence.parse(evidenceInput);
  const { signature, ...unsigned } = evidence;
  return cryptoVerify(
    null,
    createDeviceEvidenceSignaturePayload(unsigned),
    publicKey,
    Buffer.from(signature, 'base64'),
  );
}
