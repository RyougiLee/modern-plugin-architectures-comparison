import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createHeapDiagnosticManifest,
  portableDiagnosticPath,
} from '../diagnostic/heap-manifest.js';
import {
  HEAP_DIAGNOSTIC_DEFAULTS,
  HEAP_DIAGNOSTIC_RELATIVE_OUTPUT,
} from '../diagnostic/heap-config.js';

test('heap diagnostic manifest stores distinct portable artifact paths', () => {
  const directory = resolve('C:/portable-test/results/diagnostic/heap/heap-nestjs-test');
  const baseline = resolve(directory, 'nestjs-heap-nestjs-test-baseline.heapsnapshot');
  const final = resolve(directory, 'nestjs-heap-nestjs-test-final.heapsnapshot');
  const analysis = resolve(directory, 'nestjs-heap-nestjs-test-comparison.json');
  const manifest = createHeapDiagnosticManifest({
    diagnosticId: 'heap-nestjs-test',
    framework: 'nestjs',
    packageVersions: { '@nestjs/core': '11.2.5' },
    gitMetadata: {
      gitCommit: 'abc123',
      workingTreeDirty: true,
      gitRepositoryRoot: 'D:/local/repository',
    },
    packageLockSha256: 'a'.repeat(64),
    parameters: { ...HEAP_DIAGNOSTIC_DEFAULTS },
    baselineSnapshotPath: baseline,
    finalSnapshotPath: final,
    analysisPath: analysis,
    outputDirectory: directory,
    validation: {
      warmupCyclesCompleted: 100,
      completedCycles: 10_000,
      checksumsVerified: true,
      registrationsVerified: true,
      expectedSubscriptionsPerPlugin: 4,
      maximumObservedSubscriptions: 4,
      resourcesReleased: true,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  assert.notEqual(manifest.snapshotPaths.baseline, manifest.snapshotPaths.final);
  assert.equal(manifest.snapshotPaths.baseline, 'nestjs-heap-nestjs-test-baseline.heapsnapshot');
  assert.equal(manifest.snapshotPaths.final, 'nestjs-heap-nestjs-test-final.heapsnapshot');
  assert.equal('gitRepositoryRoot' in manifest, false);
  assert.equal(JSON.stringify(manifest).includes('D:/local/repository'), false);
  assert.equal(manifest.validation.completedCycles, 10_000);
});

test('heap diagnostic output and defaults remain separate from normal benchmark configuration', () => {
  assert.equal(HEAP_DIAGNOSTIC_RELATIVE_OUTPUT, 'results/diagnostic/heap');
  assert.equal(HEAP_DIAGNOSTIC_RELATIVE_OUTPUT.includes('02_data/raw'), false);
  assert.deepEqual(HEAP_DIAGNOSTIC_DEFAULTS, {
    payloadSizeBytes: 4096,
    subscriptionCount: 4,
    eventCount: 32,
    warmupCycles: 100,
    lifecycleCycles: 10_000,
  });
  assert.throws(
    () => portableDiagnosticPath(resolve('C:/diagnostic'), resolve('C:/outside/file.json')),
    /inside its output directory/,
  );
});
