import { ControlledEventBus } from './event-bus.js';
import type { ResourceDisposer } from './resource-ledger.js';
import type { WorkloadParameters, WorkloadResult, WorkloadSpec } from './types.js';

export type SubscriptionRegistrar = (create: () => ResourceDisposer) => void;

const INITIAL_CHECKSUM = 0x811c9dc5;
const CHECKSUM_MULTIPLIER = 0x01000193;

export function validateWorkloadParameters(parameters: WorkloadParameters): void {
  const entries: [keyof WorkloadParameters, number][] = [
    ['payloadSizeBytes', parameters.payloadSizeBytes],
    ['subscriptionCount', parameters.subscriptionCount],
    ['eventCount', parameters.eventCount],
  ];
  for (const [name, value] of entries) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer; received ${value}.`);
    }
  }
}

function payloadByte(index: number, pluginOrdinal: number): number {
  return (Math.imul(index, 31) + Math.imul(pluginOrdinal, 17) + 23) & 0xff;
}

function updateChecksum(
  checksum: number,
  value: number,
  sequence: number,
  subscriptionIndex: number,
  pluginOrdinal: number,
): number {
  const multiplied = Math.imul((checksum ^ value) >>> 0, CHECKSUM_MULTIPLIER);
  return (multiplied + sequence + subscriptionIndex + pluginOrdinal) >>> 0;
}

function buildPayload(size: number, pluginOrdinal: number): Uint8Array {
  const payload = new Uint8Array(size);
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = payloadByte(index, pluginOrdinal);
  }
  return payload;
}

export function computeExpectedChecksum(
  spec: WorkloadParameters & { pluginOrdinal: number },
): number {
  validateWorkloadParameters(spec);
  let checksum = INITIAL_CHECKSUM;

  for (let sequence = 0; sequence < spec.eventCount; sequence += 1) {
    for (let subscriptionIndex = 0; subscriptionIndex < spec.subscriptionCount; subscriptionIndex += 1) {
      const index =
        (Math.imul(sequence, 31) + Math.imul(subscriptionIndex, 17) + spec.pluginOrdinal) %
        spec.payloadSizeBytes;
      checksum = updateChecksum(
        checksum,
        payloadByte(index, spec.pluginOrdinal),
        sequence,
        subscriptionIndex,
        spec.pluginOrdinal,
      );
    }
  }

  return checksum;
}

export function createWorkloadSpec(
  parameters: WorkloadParameters,
  ownerId: string,
  pluginOrdinal: number,
): WorkloadSpec {
  const input = { ...parameters, ownerId, pluginOrdinal };
  return { ...input, expectedChecksum: computeExpectedChecksum(input) };
}

export class DeterministicWorkload {
  private readonly payload: Uint8Array;
  private readonly expectedChecksum: number;
  private checksum = INITIAL_CHECKSUM;
  private registered = false;
  private exercised = false;

  constructor(
    private readonly bus: ControlledEventBus,
    private readonly spec: WorkloadSpec,
  ) {
    validateWorkloadParameters(spec);
    if (!Number.isSafeInteger(spec.pluginOrdinal) || spec.pluginOrdinal <= 0) {
      throw new Error(`pluginOrdinal must be a positive safe integer; received ${spec.pluginOrdinal}.`);
    }
    if (spec.ownerId.length === 0) {
      throw new Error('ownerId must not be empty.');
    }

    this.payload = buildPayload(spec.payloadSizeBytes, spec.pluginOrdinal);
    this.expectedChecksum = spec.expectedChecksum;
  }

  registerSubscriptions(register: SubscriptionRegistrar): void {
    if (this.registered) throw new Error(`Workload ${this.spec.ownerId} is already registered.`);

    for (let subscriptionIndex = 0; subscriptionIndex < this.spec.subscriptionCount; subscriptionIndex += 1) {
      register(() =>
        this.bus.subscribe(this.spec.ownerId, (event) => {
          const index =
            (Math.imul(event.sequence, 31) +
              Math.imul(subscriptionIndex, 17) +
              event.pluginOrdinal) %
            this.payload.length;
          this.checksum = updateChecksum(
            this.checksum,
            this.payload[index]!,
            event.sequence,
            subscriptionIndex,
            event.pluginOrdinal,
          );
        }),
      );
    }

    this.registered = true;
  }

  exercise(): WorkloadResult {
    if (!this.registered) throw new Error(`Workload ${this.spec.ownerId} is not registered.`);
    if (this.exercised) throw new Error(`Workload ${this.spec.ownerId} was already exercised.`);

    let deliveredEvents = 0;
    for (let sequence = 0; sequence < this.spec.eventCount; sequence += 1) {
      deliveredEvents += this.bus.emit({ sequence, pluginOrdinal: this.spec.pluginOrdinal });
    }
    this.exercised = true;

    return {
      checksum: this.checksum,
      expectedChecksum: this.expectedChecksum,
      deliveredEvents,
    };
  }

  get expectedResult(): number {
    return this.expectedChecksum;
  }
}
