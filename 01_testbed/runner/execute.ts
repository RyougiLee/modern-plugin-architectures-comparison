import { createAdapter } from '../shared/adapter-factory.js';
import {
  assertRegisteredResources,
  assertResourcesReleased,
  assertWorkloadResult,
} from '../shared/invariants.js';
import type {
  LifecycleAdapter,
  MemoryParameters,
  MemoryRecord,
  PerformanceParameters,
  RunArtifact,
  WorkloadSpec,
} from '../shared/types.js';
import { createWorkloadSpec, validateWorkloadParameters } from '../shared/workload.js';
import { createRunManifest } from './metadata.js';
import {
  createMemoryDiagnostics,
  createPerformanceStabilityDiagnostics,
  PerformanceMeasurementBuffer,
} from './measurement-diagnostics.js';
import type { WorkerRequest } from './worker-contract.js';

function assertCycleResult(
  adapter: LifecycleAdapter,
  spec: WorkloadSpec,
  expectedFromLoad: number,
  result: ReturnType<LifecycleAdapter['exercise']>,
): ReturnType<LifecycleAdapter['exercise']> {
  assertWorkloadResult(result, spec);
  if (result.expectedChecksum !== expectedFromLoad) {
    throw new Error(
      `Expected checksum changed between load and exercise for ${adapter.framework}/${spec.ownerId}.`,
    );
  }
  return result;
}

async function runUntimedCycle(
  adapter: LifecycleAdapter,
  spec: WorkloadSpec,
): Promise<{
  result: ReturnType<LifecycleAdapter['exercise']>;
  observedSubscriptions: number;
}> {
  const expectedChecksum = await adapter.load(spec);
  const registration = assertRegisteredResources(adapter, spec);
  const result = adapter.exercise();
  assertCycleResult(adapter, spec, expectedChecksum, result);
  await adapter.dispose();
  assertResourcesReleased(adapter, spec.ownerId);
  return { result, observedSubscriptions: registration.activeSubscriptions };
}

function makeSpec(
  parameters: Pick<PerformanceParameters, 'payloadSizeBytes' | 'subscriptionCount' | 'eventCount'>,
  ownerId: string,
  pluginOrdinal: number,
): WorkloadSpec {
  return createWorkloadSpec(
    {
      payloadSizeBytes: parameters.payloadSizeBytes,
      subscriptionCount: parameters.subscriptionCount,
      eventCount: parameters.eventCount,
    },
    ownerId,
    pluginOrdinal,
  );
}

async function runPerformance(request: WorkerRequest): Promise<RunArtifact> {
  const parameters = request.parameters as PerformanceParameters;
  validateWorkloadParameters(parameters);
  if (!Number.isSafeInteger(parameters.warmupCycles) || parameters.warmupCycles < 0) {
    throw new Error('warmupCycles must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(parameters.measuredCycles) || parameters.measuredCycles <= 0) {
    throw new Error('measuredCycles must be a positive safe integer.');
  }

  const adapter = createAdapter(request.framework);
  const measurements = new PerformanceMeasurementBuffer(parameters.measuredCycles);
  let completedCycles = 0;
  let maximumObservedSubscriptions = 0;
  let warmupCyclesCompleted = 0;
  await adapter.initialize();

  try {
    for (let cycle = 1; cycle <= parameters.warmupCycles; cycle += 1) {
      const warmup = await runUntimedCycle(
        adapter,
        makeSpec(parameters, `${request.runId}-warmup-${cycle}`, cycle),
      );
      maximumObservedSubscriptions = Math.max(
        maximumObservedSubscriptions,
        warmup.observedSubscriptions,
      );
      warmupCyclesCompleted = cycle;
    }

    for (let cycle = 1; cycle <= parameters.measuredCycles; cycle += 1) {
      const pluginOrdinal = parameters.warmupCycles + cycle;
      const spec = makeSpec(parameters, `${request.runId}-measured-${cycle}`, pluginOrdinal);

      const loadStart = process.hrtime.bigint();
      const expectedChecksum = await adapter.load(spec);
      const loadEnd = process.hrtime.bigint();

      const registration = assertRegisteredResources(adapter, spec);
      maximumObservedSubscriptions = Math.max(
        maximumObservedSubscriptions,
        registration.activeSubscriptions,
      );

      const exerciseStart = process.hrtime.bigint();
      const result = adapter.exercise();
      const exerciseEnd = process.hrtime.bigint();
      assertCycleResult(adapter, spec, expectedChecksum, result);

      const disposeStart = process.hrtime.bigint();
      await adapter.dispose();
      const disposeEnd = process.hrtime.bigint();
      assertResourcesReleased(adapter, spec.ownerId);

      const loadNanoseconds = loadEnd - loadStart;
      const exerciseNanoseconds = exerciseEnd - exerciseStart;
      const disposeNanoseconds = disposeEnd - disposeStart;

      measurements.set(
        cycle - 1,
        loadNanoseconds,
        exerciseNanoseconds,
        disposeNanoseconds,
        result.checksum,
        result.deliveredEvents,
      );
      completedCycles = cycle;
    }
  } finally {
    await adapter.close();
  }

  const records = measurements.toRecords(request.runId);
  return {
    manifest: await createRunManifest(request),
    records,
    stabilityDiagnostics: createPerformanceStabilityDiagnostics(measurements),
    validation: {
      completedCycles,
      expectedCycles: parameters.measuredCycles,
      warmupCyclesCompleted,
      checksumsVerified: completedCycles === parameters.measuredCycles,
      registrationsVerified:
        completedCycles === parameters.measuredCycles &&
        maximumObservedSubscriptions === parameters.subscriptionCount,
      expectedSubscriptionsPerPlugin: parameters.subscriptionCount,
      maximumObservedSubscriptions,
      resourcesReleased: completedCycles === parameters.measuredCycles,
    },
  };
}

export function validateMemoryCheckpoints(parameters: MemoryParameters): void {
  if (!Number.isSafeInteger(parameters.lifecycleCycles) || parameters.lifecycleCycles <= 0) {
    throw new Error('lifecycleCycles must be a positive safe integer.');
  }
  const normalized = [...new Set(parameters.checkpoints)].sort((left, right) => left - right);
  if (
    normalized.length !== parameters.checkpoints.length ||
    normalized[0] !== 0 ||
    normalized.at(-1) !== parameters.lifecycleCycles ||
    normalized.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error(
      'Memory checkpoints must be unique, sorted, begin at 0, and end at lifecycleCycles.',
    );
  }
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] !== parameters.checkpoints[index]) {
      throw new Error('Memory checkpoints must be provided in ascending order.');
    }
  }
}

function takeMemoryRecord(
  adapter: LifecycleAdapter,
  checkpointCycle: number,
  forceGc: boolean,
): MemoryRecord {
  if (forceGc) {
    if (!globalThis.gc) throw new Error('Forced GC requested, but the worker lacks --expose-gc.');
    globalThis.gc();
  }

  const usage = process.memoryUsage();
  return {
    checkpointCycle,
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    ledger: adapter.ledgerSnapshot(),
    forcedGc: forceGc,
  };
}

async function runMemory(request: WorkerRequest): Promise<RunArtifact> {
  const parameters = request.parameters as MemoryParameters;
  validateWorkloadParameters(parameters);
  validateMemoryCheckpoints(parameters);
  if (!Number.isSafeInteger(parameters.memoryWarmupCycles) || parameters.memoryWarmupCycles < 0) {
    throw new Error('memoryWarmupCycles must be a non-negative safe integer.');
  }

  const adapter = createAdapter(request.framework);
  const records: MemoryRecord[] = [];
  const checkpointSet = new Set(parameters.checkpoints);
  let completedCycles = 0;
  let warmupCyclesCompleted = 0;
  let maximumObservedSubscriptions = 0;
  await adapter.initialize();

  try {
    for (let cycle = 1; cycle <= parameters.memoryWarmupCycles; cycle += 1) {
      const warmup = await runUntimedCycle(
        adapter,
        makeSpec(parameters, `${request.runId}-memory-warmup-${cycle}`, cycle),
      );
      maximumObservedSubscriptions = Math.max(
        maximumObservedSubscriptions,
        warmup.observedSubscriptions,
      );
      warmupCyclesCompleted = cycle;
    }

    records.push(takeMemoryRecord(adapter, 0, parameters.forceGc));
    for (let cycle = 1; cycle <= parameters.lifecycleCycles; cycle += 1) {
      const pluginOrdinal = parameters.memoryWarmupCycles + cycle;
      const spec = makeSpec(parameters, `${request.runId}-memory-${cycle}`, pluginOrdinal);
      const measured = await runUntimedCycle(adapter, spec);
      maximumObservedSubscriptions = Math.max(
        maximumObservedSubscriptions,
        measured.observedSubscriptions,
      );
      completedCycles = cycle;
      if (checkpointSet.has(cycle)) {
        records.push(takeMemoryRecord(adapter, cycle, parameters.forceGc));
      }
    }
  } finally {
    await adapter.close();
  }

  const resourcesReleased = records.every(
    ({ ledger }) => ledger.totalActiveResources === 0 && ledger.activeSubscriptions === 0,
  );
  return {
    manifest: await createRunManifest(request),
    records,
    memoryDiagnostics: createMemoryDiagnostics(records),
    validation: {
      completedCycles,
      expectedCycles: parameters.lifecycleCycles,
      warmupCyclesCompleted,
      checksumsVerified: completedCycles === parameters.lifecycleCycles,
      registrationsVerified:
        completedCycles === parameters.lifecycleCycles &&
        maximumObservedSubscriptions === parameters.subscriptionCount,
      expectedSubscriptionsPerPlugin: parameters.subscriptionCount,
      maximumObservedSubscriptions,
      resourcesReleased,
    },
  };
}

export async function executeWorkerRequest(request: WorkerRequest): Promise<RunArtifact> {
  if (request.suite === 'performance') return runPerformance(request);
  return runMemory(request);
}
