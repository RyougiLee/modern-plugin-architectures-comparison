import assert from 'node:assert/strict';
import test from 'node:test';

import { countRq3 } from '../rq3/count.js';

test('rq3-sloc-v2 separates nominal, host shutdown, and failure recovery actions', async () => {
  const report = await countRq3();

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.countingRuleVersion, 'rq3-sloc-v2');
  assert.deepEqual(report.frameworks.nestjs, {
    pluginLifecycleSloc: 26,
    frameworkSpecificLifecycleOrchestrationSloc: 48,
    cleanupSloc: 22,
    nominalPluginCleanupActions: 3,
    hostShutdownCleanupActions: 2,
    failureRecoveryCleanupActions: 0,
    countedFiles: ['nestjs-app/nestjs-adapter.ts'],
  });
  assert.deepEqual(report.frameworks.cordis, {
    pluginLifecycleSloc: 15,
    frameworkSpecificLifecycleOrchestrationSloc: 53,
    cleanupSloc: 17,
    nominalPluginCleanupActions: 2,
    hostShutdownCleanupActions: 2,
    failureRecoveryCleanupActions: 1,
    countedFiles: ['cordis-app/cordis-adapter.ts'],
  });
  assert.equal('explicitCleanupActions' in report.frameworks.nestjs, false);
  assert.equal('explicitCleanupActions' in report.frameworks.cordis, false);
});
