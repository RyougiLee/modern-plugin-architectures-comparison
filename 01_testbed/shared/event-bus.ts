import { ResourceLedger, type ResourceDisposer } from './resource-ledger.js';

export interface WorkloadEvent {
  sequence: number;
  pluginOrdinal: number;
}

export type WorkloadCallback = (event: WorkloadEvent) => void;

export class ControlledEventBus {
  private nextSubscriptionId = 1;
  private readonly callbacks = new Map<number, WorkloadCallback>();

  constructor(private readonly ledger: ResourceLedger) {}

  subscribe(ownerId: string, callback: WorkloadCallback): ResourceDisposer {
    const subscriptionId = this.nextSubscriptionId++;
    const releaseLedgerEntry = this.ledger.registerSubscription(ownerId);
    this.callbacks.set(subscriptionId, callback);
    let active = true;

    return () => {
      if (!active) return;
      active = false;
      if (!this.callbacks.delete(subscriptionId)) {
        throw new Error(`Subscription ${subscriptionId} is missing from the event bus.`);
      }
      releaseLedgerEntry();
    };
  }

  emit(event: WorkloadEvent): number {
    let delivered = 0;
    for (const callback of this.callbacks.values()) {
      callback(event);
      delivered += 1;
    }
    return delivered;
  }

  get activeSubscriptionCount(): number {
    return this.callbacks.size;
  }
}
