import type { HeapDiagnosticParameters } from './heap-types.js';

export const HEAP_DIAGNOSTIC_DEFAULTS: Readonly<HeapDiagnosticParameters> = Object.freeze({
  payloadSizeBytes: 4096,
  subscriptionCount: 4,
  eventCount: 32,
  warmupCycles: 100,
  lifecycleCycles: 10_000,
});

export const HEAP_DIAGNOSTIC_RELATIVE_OUTPUT = 'results/diagnostic/heap';
