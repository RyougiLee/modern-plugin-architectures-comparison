import type { ResourceLedgerSnapshot } from './types.js';

interface ResourceRecord {
  id: number;
  ownerId: string;
  kind: 'subscription';
}

export type ResourceDisposer = () => void;

export class ResourceLedger {
  private nextId = 1;
  private readonly resources = new Map<number, ResourceRecord>();

  registerSubscription(ownerId: string): ResourceDisposer {
    if (ownerId.length === 0) {
      throw new Error('Resource owner ID must not be empty.');
    }

    const id = this.nextId++;
    this.resources.set(id, { id, ownerId, kind: 'subscription' });
    let active = true;

    return () => {
      if (!active) return;
      active = false;
      if (!this.resources.delete(id)) {
        throw new Error(`Controlled resource ${id} is missing from the ledger.`);
      }
    };
  }

  countForOwner(ownerId: string): number {
    let count = 0;
    for (const resource of this.resources.values()) {
      if (resource.ownerId === ownerId) count += 1;
    }
    return count;
  }

  assertOwnerCount(ownerId: string, expected: number): void {
    const actual = this.countForOwner(ownerId);
    if (actual !== expected) {
      throw new Error(
        `Resource invariant failed for ${ownerId}: expected ${expected}, found ${actual}.`,
      );
    }
  }

  assertEmpty(): void {
    if (this.resources.size !== 0) {
      const owners = [...new Set([...this.resources.values()].map(({ ownerId }) => ownerId))];
      throw new Error(
        `Resource ledger is not empty: ${this.resources.size} active resource(s) owned by ${owners.join(', ')}.`,
      );
    }
  }

  snapshot(): ResourceLedgerSnapshot {
    const ownerCounts = new Map<string, number>();
    for (const resource of this.resources.values()) {
      ownerCounts.set(resource.ownerId, (ownerCounts.get(resource.ownerId) ?? 0) + 1);
    }

    return {
      activeSubscriptions: this.resources.size,
      totalActiveResources: this.resources.size,
      owners: [...ownerCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([ownerId, count]) => ({
          ownerId,
          activeSubscriptions: count,
          totalActiveResources: count,
        })),
    };
  }
}
