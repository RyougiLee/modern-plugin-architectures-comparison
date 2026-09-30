import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertFinalGitState } from '../runner/metadata.js';
import { verifyRunArtifactFile, writeRunArtifact } from '../runner/output.js';
import {
  createExperimentId,
  createWorkerRequest,
  frameworkSchedule,
  runFreshProcess,
} from '../runner/process-runner.js';
import type { GitMetadata, PerformanceRecord } from '../shared/types.js';

const unavailableGit: GitMetadata = {
  gitCommit: null,
  workingTreeDirty: null,
  gitRepositoryRoot: null,
};

test('framework schedule alternates order for successive replicates', () => {
  assert.deepEqual(frameworkSchedule(['nestjs', 'cordis'], 3), [
    { framework: 'nestjs', replicate: 1 },
    { framework: 'cordis', replicate: 1 },
    { framework: 'cordis', replicate: 2 },
    { framework: 'nestjs', replicate: 2 },
    { framework: 'nestjs', replicate: 3 },
    { framework: 'cordis', replicate: 3 },
  ]);
});

test('final Git guard rejects unavailable and dirty states without using the real repository', () => {
  assert.throws(() => assertFinalGitState('final', unavailableGit), /Final run rejected/);
  assert.throws(
    () =>
      assertFinalGitState('final', {
        gitCommit: 'abc123',
        workingTreeDirty: true,
        gitRepositoryRoot: 'C:/repo',
      }),
    /working tree is dirty/,
  );
  assert.doesNotThrow(() =>
    assertFinalGitState('final', {
      gitCommit: 'abc123',
      workingTreeDirty: false,
      gitRepositoryRoot: 'C:/repo',
    }),
  );
  assert.doesNotThrow(() => assertFinalGitState('pilot', unavailableGit));
});

test('performance record isolates three operations and raw output cannot be overwritten', async () => {
  const experimentId = createExperimentId('pilot');
  const request = createWorkerRequest(
    experimentId,
    'performance',
    'nestjs',
    'pilot',
    1,
    {
      payloadSizeBytes: 128,
      subscriptionCount: 2,
      eventCount: 3,
      warmupCycles: 1,
      measuredCycles: 2,
    },
    unavailableGit,
  );
  const artifact = await runFreshProcess(request);
  const records = artifact.records as PerformanceRecord[];
  assert.equal(records.length, 2);
  assert.equal(artifact.manifest.experimentId, experimentId);
  assert.equal('gitRepositoryRoot' in artifact.manifest, false);
  assert.match(artifact.manifest.packageLockSha256, /^[a-f0-9]{64}$/);
  assert.equal(artifact.manifest.forcedGc, false);
  assert.equal(artifact.validation.registrationsVerified, true);
  assert.equal(artifact.validation.expectedSubscriptionsPerPlugin, 2);
  assert.equal(artifact.validation.maximumObservedSubscriptions, 2);
  assert.equal(artifact.stabilityDiagnostics?.blockCount, 2);
  for (const record of records) {
    assert.equal(
      BigInt(record.measuredTotalNanoseconds),
      BigInt(record.loadNanoseconds) +
        BigInt(record.exerciseNanoseconds) +
        BigInt(record.disposeNanoseconds),
    );
    assert.ok(!('totalCycleNanoseconds' in record));
    assert.equal(record.ownerId, `${request.runId}-measured-${record.cycle}`);
    assert.equal(record.deliveredEvents, 6);
    assert.equal(record.checksum, record.checksum >>> 0);
  }

  const directory = await mkdtemp(join(tmpdir(), 'lifecycle-testbed-'));
  try {
    const path = await writeRunArtifact(artifact, directory);
    await verifyRunArtifactFile(path, artifact.manifest.runId);
    await assert.rejects(writeRunArtifact(artifact, directory), { code: 'EEXIST' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('memory warm-up completes before checkpoint 0 and is excluded from checkpoints', async () => {
  const request = createWorkerRequest(
    createExperimentId('pilot'),
    'memory',
    'cordis',
    'pilot',
    1,
    {
      payloadSizeBytes: 128,
      subscriptionCount: 2,
      eventCount: 3,
      memoryWarmupCycles: 3,
      lifecycleCycles: 2,
      checkpoints: [0, 1, 2],
      forceGc: true,
    },
    unavailableGit,
  );
  const artifact = await runFreshProcess(request);
  const records = artifact.records as Array<{
    checkpointCycle: number;
    ledger: { totalActiveResources: number };
    forcedGc: boolean;
  }>;
  assert.equal(artifact.validation.warmupCyclesCompleted, 3);
  assert.deepEqual(records.map(({ checkpointCycle }) => checkpointCycle), [0, 1, 2]);
  assert.ok(records.every(({ ledger }) => ledger.totalActiveResources === 0));
  assert.ok(records.every(({ forcedGc }) => forcedGc));
  assert.equal(artifact.validation.registrationsVerified, true);
  assert.equal(artifact.validation.maximumObservedSubscriptions, 2);
  assert.equal(artifact.memoryDiagnostics?.baselineCheckpointCycle, 0);
  assert.deepEqual(
    artifact.memoryDiagnostics?.checkpointDeltas.map(({ checkpointCycle }) => checkpointCycle),
    [0, 1, 2],
  );
});
