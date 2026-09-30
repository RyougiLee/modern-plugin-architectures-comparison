import assert from 'node:assert/strict';
import test from 'node:test';

import { CordisLifecycleAdapter } from '../cordis-app/cordis-adapter.js';
import { NestjsLifecycleAdapter } from '../nestjs-app/nestjs-adapter.js';
import {
  assertRegisteredResources,
  assertResourcesReleased,
  assertWorkloadResult,
} from '../shared/invariants.js';
import type { LifecycleAdapter, WorkloadResult, WorkloadSpec } from '../shared/types.js';
import { createWorkloadSpec } from '../shared/workload.js';

async function exerciseAdapter(adapter: LifecycleAdapter): Promise<WorkloadResult> {
  const spec: WorkloadSpec = createWorkloadSpec(
    { payloadSizeBytes: 1024, subscriptionCount: 4, eventCount: 17 },
    `${adapter.framework}-smoke`,
    13,
  );

  await adapter.initialize();
  try {
    const expected = await adapter.load(spec);
    assertRegisteredResources(adapter, spec);
    const result = adapter.exercise();
    assertWorkloadResult(result, spec);
    assert.equal(result.expectedChecksum, expected);
    await adapter.dispose();
    assertResourcesReleased(adapter, spec.ownerId);
    return result;
  } finally {
    await adapter.close();
  }
}

test('Cordis and NestJS adapters execute equivalent nominal work', async () => {
  const nestjs = await exerciseAdapter(new NestjsLifecycleAdapter());
  const cordis = await exerciseAdapter(new CordisLifecycleAdapter());

  assert.equal(nestjs.checksum, cordis.checksum);
  assert.equal(nestjs.expectedChecksum, cordis.expectedChecksum);
  assert.equal(nestjs.deliveredEvents, cordis.deliveredEvents);
});

test('both initialized hosts remain stable across 100 sequential lifecycle cycles', async () => {
  for (const adapter of [new NestjsLifecycleAdapter(), new CordisLifecycleAdapter()]) {
    await adapter.initialize();
    try {
      for (let cycle = 1; cycle <= 100; cycle += 1) {
        const spec = createWorkloadSpec(
          { payloadSizeBytes: 64, subscriptionCount: 2, eventCount: 3 },
          `${adapter.framework}-repeated-${cycle}`,
          cycle,
        );
        const expected = await adapter.load(spec);
        assertRegisteredResources(adapter, spec);
        const result = adapter.exercise();
        assertWorkloadResult(result, spec);
        assert.equal(result.expectedChecksum, expected);
        await adapter.dispose();
        assertResourcesReleased(adapter, spec.ownerId);
      }
    } finally {
      await adapter.close();
    }
  }
});
