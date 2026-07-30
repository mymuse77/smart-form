import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@smart-form/contracts': fileURLToPath(new URL(
        './packages/contracts/src/index.ts',
        import.meta.url,
      )),
      '@smart-form/capability-sdk': fileURLToPath(new URL(
        './packages/capability-sdk/src/index.ts',
        import.meta.url,
      )),
    },
  },
  test: {
    environment: 'node',
    include: [
      'apps/**/src/**/*.test.ts',
      'packages/**/src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/spike-profile-*/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'apps/desktop/src/agent/artifact-loader.ts',
        'apps/desktop/src/agent/artifact-trust.ts',
        'apps/desktop/src/agent/control-lease.ts',
        'apps/desktop/src/agent/realtime-client.ts',
        'apps/desktop/src/agent/runner-executor.ts',
        'apps/desktop/src/agent/sidecar-client.ts',
        'apps/desktop/src/agent/sidecar-executor.ts',
        'apps/desktop/src/agent/task-orchestrator.ts',
        'apps/desktop/src/main/db.ts',
        'apps/server/src/artifacts/artifact-store.ts',
        'apps/server/src/artifacts/artifact.service.ts',
        'apps/server/src/realtime/realtime-hub.ts',
        'apps/server/src/realtime/session-registry.ts',
        'apps/server/src/resources/in-memory-resource.repository.ts',
        'apps/server/src/resources/resource.service.ts',
        'apps/server/src/tasks/task-coordinator.ts',
        'packages/capability-sdk/src/artifact-security.ts',
        'packages/capability-sdk/src/capability-bundle.ts',
        'packages/capability-sdk/src/device-evidence.ts',
        'packages/playwright-runner/src/program-runner.ts',
        'packages/playwright-runner/src/domain-policy.ts',
      ],
      exclude: ['**/*.test.ts', '**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
    },
  },
});
