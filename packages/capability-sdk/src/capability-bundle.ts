import {
  CapabilityArtifactBundle,
  type ArtifactReference,
  type CapabilityArtifactBundle as CapabilityArtifactBundleValue,
  type RuntimeCompatibility,
  type TaskDefinition,
} from '@smart-form/contracts';

const COMMIT_SELECTOR = /submit|confirm|approve|save|send|pay|提交|确认|保存|发送|支付/i;

function normalizeDomain(value: string): string {
  return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
}

export function parseCapabilityArtifact(content: Buffer): CapabilityArtifactBundleValue {
  let decoded: unknown;
  try {
    decoded = JSON.parse(content.toString('utf8'));
  } catch {
    throw new Error('Capability artifact is not valid UTF-8 JSON');
  }
  return CapabilityArtifactBundle.parse(decoded);
}

export function validateCapabilityBundlePublication(
  content: Buffer,
  expected: {
    artifactId: string;
    tenantId: string;
    version: string;
    compatibility: RuntimeCompatibility;
  },
): CapabilityArtifactBundleValue {
  const bundle = parseCapabilityArtifact(content);
  const { manifest } = bundle;
  if (
    manifest.capabilityId !== expected.artifactId
    || manifest.version !== expected.version
    || manifest.tenantId !== expected.tenantId
  ) {
    throw new Error('Capability manifest identity does not match the publication');
  }
  if (manifest.validation.status !== 'passed') {
    throw new Error('Capability has not passed validation');
  }
  if (manifest.entrypoint !== 'program') {
    throw new Error('Declarative capabilities must use the program entrypoint');
  }

  const siteDomains = new Set(manifest.site.domains.map(normalizeDomain));
  for (const domain of manifest.permissions.domains) {
    if (!siteDomains.has(normalizeDomain(domain))) {
      throw new Error(`Capability permission is outside its declared sites: ${domain}`);
    }
  }

  const manifestRuntime = {
    protocolVersion: manifest.runtime.protocolVersion,
    sdkRange: manifest.runtime.sdkRange,
    playwrightRange: manifest.runtime.playwrightRange,
    nodeRange: manifest.runtime.nodeRange,
    browser: manifest.runtime.browser,
    executionModes: manifest.runtime.executionModes,
  };
  if (
    JSON.stringify(manifestRuntime) !== JSON.stringify(expected.compatibility)
  ) {
    throw new Error('Capability runtime does not match publication compatibility metadata');
  }

  const submitSteps = bundle.program.filter((step) => step.type === 'submit');
  if (manifest.mode === 'read') {
    const writeStep = bundle.program.find((step) => (
      step.type === 'fill' || step.type === 'select' || step.type === 'submit'
    ));
    if (writeStep) throw new Error(`Read capability contains a write step: ${writeStep.type}`);
  }
  if (submitSteps.length > 0 && (
    manifest.mode !== 'write'
    || !manifest.requiresApproval
    || manifest.riskLevel !== 'high'
  )) {
    throw new Error('Submit steps require a high-risk write capability with approval');
  }
  for (const step of bundle.program) {
    if (step.type === 'click' && COMMIT_SELECTOR.test(step.selector)) {
      throw new Error(`Commit-like selector must use an approved submit step: ${step.selector}`);
    }
  }
  return bundle;
}

export function parseAndValidateCapabilityBundle(
  content: Buffer,
  reference: ArtifactReference,
  task: TaskDefinition,
): CapabilityArtifactBundleValue {
  if (!reference.compatibility) {
    throw new Error('Capability reference does not include compatibility metadata');
  }
  const bundle = validateCapabilityBundlePublication(content, {
    artifactId: reference.artifactId,
    tenantId: reference.tenantId,
    version: reference.version,
    compatibility: reference.compatibility,
  });
  const { manifest } = bundle;
  if (manifest.tenantId !== task.tenantId) {
    throw new Error('Capability tenant does not match the task tenant');
  }
  if (manifest.mode !== task.mode || manifest.taskType !== task.taskType) {
    throw new Error('Capability mode does not match the task');
  }

  const taskDomains = new Set(task.site.allowedDomains.map(normalizeDomain));
  for (const domain of [...manifest.site.domains, ...manifest.permissions.domains]) {
    if (!taskDomains.has(normalizeDomain(domain))) {
      throw new Error(`Capability requests a domain outside the task scope: ${domain}`);
    }
  }
  for (const step of bundle.program) {
    if (step.type === 'navigate' && !taskDomains.has(normalizeDomain(step.url))) {
      throw new Error(`Capability navigation is outside the task scope: ${step.url}`);
    }
  }
  return bundle;
}
