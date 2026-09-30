import { ControlledEventBus } from './event-bus.js';
import { ResourceLedger } from './resource-ledger.js';

export class BenchmarkServices {
  readonly ledger = new ResourceLedger();
  readonly eventBus = new ControlledEventBus(this.ledger);
}
