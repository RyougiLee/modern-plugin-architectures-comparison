import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { BatchTracker, type BatchManifest } from '../runner/batch.js';
import { WorkerProcessError } from '../runner/process-runner.js';

test('batch manifest preserves a failed run and leaves later runs incomplete', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lifecycle-batch-'));
  try {
    const tracker = await BatchTracker.create(directory, 'test-experiment', 'pilot', [
      { runId: 'run-1', suite: 'performance', framework: 'nestjs', replicate: 1 },
      { runId: 'run-2', suite: 'performance', framework: 'cordis', replicate: 1 },
    ]);
    const failure = new WorkerProcessError(
      'run-1',
      17,
      'TypeError: failed in D:\\Learning\\Thesis\\testbed\\worker.ts\n    at worker (D:\\Learning\\Thesis\\testbed\\worker.ts:9:1)',
    );
    await tracker.markFailed('run-1', failure);
    await tracker.markBatchFailed(failure);

    const serialized = await readFile(tracker.path, 'utf8');
    const manifest = JSON.parse(serialized) as BatchManifest;
    assert.equal(manifest.plannedRunCount, 2);
    assert.equal(manifest.completedRunCount, 0);
    assert.equal(manifest.failedRunCount, 1);
    assert.equal(manifest.incompleteRunCount, 1);
    assert.equal(manifest.status, 'failed');
    assert.deepEqual(manifest.runs[0]?.failure, {
      exitCode: 17,
      errorName: 'TypeError',
      message: 'failed in <local-path>',
    });
    assert.equal(manifest.runs[0]?.framework, 'nestjs');
    assert.equal(manifest.runs[0]?.suite, 'performance');
    assert.equal(manifest.runs[0]?.replicate, 1);
    assert.equal(serialized.includes('D:\\Learning\\Thesis'), false);
    assert.equal(serialized.includes('at worker'), false);
    assert.equal(manifest.runs[1]?.status, 'planned');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('batch manifest stores completed artifact paths relative to the batch directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lifecycle-batch-path-'));
  try {
    const tracker = await BatchTracker.create(directory, 'portable-experiment', 'pilot', [
      { runId: 'run-1', suite: 'performance', framework: 'nestjs', replicate: 1 },
    ]);
    const artifactPath = join(dirname(tracker.path), 'performance', 'nestjs', 'run-1.json');
    await tracker.markCompleted('run-1', artifactPath);
    await tracker.markCompletedBatch();

    const manifest = JSON.parse(await readFile(tracker.path, 'utf8')) as BatchManifest;
    assert.equal(manifest.runs[0]?.artifactPath, 'performance/nestjs/run-1.json');
    assert.equal(manifest.runs[0]?.artifactPath?.includes(directory), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
