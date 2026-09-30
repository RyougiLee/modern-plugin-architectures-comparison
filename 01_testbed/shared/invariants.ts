import type {
  LifecycleAdapter,
  ResourceLedgerSnapshot,
  WorkloadResult,
  WorkloadSpec,
} from './types.js';

export function assertRegisteredResources(
  adapter: LifecycleAdapter,
  spec: WorkloadSpec,
): ResourceLedgerSnapshot {
  const snapshot = adapter.ledgerSnapshot();
  const owner = snapshot.owners.find(({ ownerId }) => ownerId === spec.ownerId);
  if (
    snapshot.activeSubscriptions !== spec.subscriptionCount ||
    snapshot.totalActiveResources !== spec.subscriptionCount ||
    owner?.activeSubscriptions !== spec.subscriptionCount
  ) {
    throw new Error(
      `Registration invariant failed for ${adapter.framework}/${spec.ownerId}: expected ${spec.subscriptionCount} controlled subscription(s), found ${snapshot.activeSubscriptions}.`,
    );
  }
  return snapshot;
}

export function assertWorkloadResult(result: WorkloadResult, spec: WorkloadSpec): void {
  const expectedDeliveries = spec.subscriptionCount * spec.eventCount;
  if (result.checksum !== result.expectedChecksum) {
    throw new Error(
      `Checksum invariant failed for ${spec.ownerId}: expected ${result.expectedChecksum}, found ${result.checksum}.`,
    );
  }
  if (result.deliveredEvents !== expectedDeliveries) {
    throw new Error(
      `Delivery invariant failed for ${spec.ownerId}: expected ${expectedDeliveries}, found ${result.deliveredEvents}.`,
    );
  }
}

export function assertResourcesReleased(adapter: LifecycleAdapter, ownerId: string): void {
  const snapshot = adapter.ledgerSnapshot();
  if (
    snapshot.activeSubscriptions !== 0 ||
    snapshot.totalActiveResources !== 0 ||
    snapshot.owners.some((owner) => owner.ownerId === ownerId)
  ) {
    throw new Error(
      `Disposal invariant failed for ${adapter.framework}/${ownerId}: ${snapshot.totalActiveResources} controlled resource(s) remain.`,
    );
  }
}
