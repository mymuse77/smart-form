import { z } from 'zod';
import { CapabilityManifest } from './capability.js';

export const CapabilityValue = z.discriminatedUnion('source', [
  z.object({ source: z.literal('literal'), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ source: z.literal('input'), key: z.string().min(1) }),
]);
export type CapabilityValue = z.infer<typeof CapabilityValue>;

const Selector = z.string().min(1).max(2_000);

export const CapabilityStep = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('navigate'),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal('click'),
    selector: Selector,
  }),
  z.object({
    type: z.literal('fill'),
    selector: Selector,
    value: CapabilityValue,
  }),
  z.object({
    type: z.literal('select'),
    selector: Selector,
    value: CapabilityValue,
  }),
  z.object({
    type: z.literal('press'),
    selector: Selector,
    key: z.string().min(1).max(100).refine(
      (key) => !/^(enter|numpadenter)$/i.test(key.trim()),
      'Enter is reserved for an approved submit step',
    ),
  }),
  z.object({
    type: z.literal('waitFor'),
    selector: Selector,
    state: z.enum(['attached', 'detached', 'visible', 'hidden']).default('visible'),
  }),
  z.object({
    type: z.literal('extract'),
    collectionSelector: Selector.optional(),
    maxRecords: z.number().int().positive().max(100_000).default(1_000),
    fields: z.array(z.object({
      name: z.string().min(1),
      selector: Selector,
      read: z.enum(['text', 'value', 'attribute']).default('text'),
      attribute: z.string().min(1).optional(),
    })).min(1),
  }),
  z.object({
    type: z.literal('submit'),
    selector: Selector,
    snapshotKeys: z.array(z.string().min(1)).default([]),
  }),
]);
export type CapabilityStep = z.infer<typeof CapabilityStep>;

export const CapabilityArtifactBundle = z.object({
  format: z.literal('smart-form-capability-v1'),
  manifest: CapabilityManifest.refine(
    (manifest) => manifest.runtime.language === 'declarative-v1',
    'Executable bundles must use the declarative-v1 runtime',
  ),
  program: z.array(CapabilityStep).min(1).max(10_000),
});
export type CapabilityArtifactBundle = z.infer<typeof CapabilityArtifactBundle>;

