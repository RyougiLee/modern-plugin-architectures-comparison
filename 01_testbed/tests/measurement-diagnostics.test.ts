import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMemoryDiagnostics,
  createPerformanceStabilityDiagnostics,
  PerformanceMeasurementBuffer,
} from '../runner/measurement-diagnostics.js';
import { validateMemoryCheckpoints } from '../runner/execute.js';
import type { MemoryRecord } from '../shared/types.js';

test('fixed performance buffers reconstruct equivalent JSON records after measurement', () => {
  const measurements = new PerformanceMeasurementBuffer(3);
  measurements.set(0, 10n, 20n, 30n, 101, 8);
  measurements.set(1, 11n, 21n, 31n, 102, 8);
  measurements.set(2, 12n, 22n, 32n, 103, 8);

  const records = measurements.toRecords('run-fixed');
  assert.equal(records.length, 3);
  assert.deepEqual(records[1], {
    cycle: 2,
    ownerId: 'run-fixed-measured-2',
    loadNanoseconds: '11',
    exerciseNanoseconds: '21',
    disposeNanoseconds: '31',
    measuredTotalNanoseconds: '63',
    checksum: 102,
    deliveredEvents: 8,
  });
  for (const record of records) {
    assert.equal(
      BigInt(record.measuredTotalNanoseconds),
      BigInt(record.loadNanoseconds) +
        BigInt(record.exerciseNanoseconds) +
        BigInt(record.disposeNanoseconds),
    );
  }
});

test('stability blocks cover measured cycles exactly once and in order', () => {
  const measurements = new PerformanceMeasurementBuffer(23);
  for (let index = 0; index < measurements.length; index += 1) {
    const value = BigInt(index + 1);
    measurements.set(index, value, value * 2n, value * 3n, index, index * 4);
  }

  const diagnostics = createPerformanceStabilityDiagnostics(measurements);
  assert.equal(diagnostics.blockCount, 10);
  const coveredCycles = diagnostics.blocks.flatMap(({ startCycle, endCycle }) =>
    Array.from({ length: endCycle - startCycle + 1 }, (_, index) => startCycle + index),
  );
  assert.deepEqual(coveredCycles, Array.from({ length: 23 }, (_, index) => index + 1));
  for (let index = 1; index < diagnostics.blocks.length; index += 1) {
    assert.equal(
      diagnostics.blocks[index]?.startCycle,
      (diagnostics.blocks[index - 1]?.endCycle ?? 0) + 1,
    );
  }
});

test('memory diagnostics calculate every delta from checkpoint 0 without changing raw records', () => {
  const ledger = { activeSubscriptions: 0, totalActiveResources: 0, owners: [] };
  const records: MemoryRecord[] = [
    {
      checkpointCycle: 0,
      rss: 1_000,
      heapTotal: 900,
      heapUsed: 500,
      external: 100,
      arrayBuffers: 25,
      ledger,
      forcedGc: true,
    },
    {
      checkpointCycle: 500,
      rss: 1_400,
      heapTotal: 950,
      heapUsed: 620,
      external: 90,
      arrayBuffers: 40,
      ledger,
      forcedGc: true,
    },
  ];
  const original = structuredClone(records);

  assert.deepEqual(createMemoryDiagnostics(records).checkpointDeltas, [
    {
      checkpointCycle: 0,
      heapUsedDeltaFromBaseline: 0,
      rssDeltaFromBaseline: 0,
      externalDeltaFromBaseline: 0,
      arrayBuffersDeltaFromBaseline: 0,
    },
    {
      checkpointCycle: 500,
      heapUsedDeltaFromBaseline: 120,
      rssDeltaFromBaseline: 400,
      externalDeltaFromBaseline: -10,
      arrayBuffersDeltaFromBaseline: 15,
    },
  ]);
  assert.deepEqual(records, original);
});

test('memory validation accepts the planned long exploratory checkpoint sequence', () => {
  assert.doesNotThrow(() =>
    validateMemoryCheckpoints({
      payloadSizeBytes: 4096,
      subscriptionCount: 4,
      eventCount: 32,
      memoryWarmupCycles: 100,
      lifecycleCycles: 10_000,
      checkpoints: [0, 500, 1_000, 2_000, 4_000, 6_000, 8_000, 10_000],
      forceGc: true,
    }),
  );
});
