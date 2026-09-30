import assert from 'node:assert/strict';
import test from 'node:test';

import { ControlledEventBus } from '../shared/event-bus.js';
import { ResourceLedger, type ResourceDisposer } from '../shared/resource-ledger.js';
import {
  computeExpectedChecksum,
  createWorkloadSpec,
  DeterministicWorkload,
} from '../shared/workload.js';
import type { WorkloadSpec } from '../shared/types.js';

test('shared workload performs deterministic callback work and exact deliveries', () => {
  const spec: WorkloadSpec = createWorkloadSpec(
    { payloadSizeBytes: 257, subscriptionCount: 3, eventCount: 11 },
    'shared-test',
    7,
  );
  const ledger = new ResourceLedger();
  const bus = new ControlledEventBus(ledger);
  const workload = new DeterministicWorkload(bus, spec);
  const disposers: ResourceDisposer[] = [];

  workload.registerSubscriptions((create) => disposers.push(create()));
  ledger.assertOwnerCount(spec.ownerId, spec.subscriptionCount);

  const result = workload.exercise();
  assert.equal(result.checksum, computeExpectedChecksum(spec));
  assert.equal(result.expectedChecksum, result.checksum);
  assert.equal(result.deliveredEvents, spec.subscriptionCount * spec.eventCount);

  for (const dispose of disposers.reverse()) dispose();
  ledger.assertEmpty();
  assert.equal(bus.activeSubscriptionCount, 0);
});
