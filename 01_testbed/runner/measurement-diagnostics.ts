import type {
  MemoryDiagnostics,
  MemoryRecord,
  PerformanceRecord,
  PerformanceStabilityDiagnostics,
} from '../shared/types.js';

type TimingKind = 'load' | 'exercise' | 'dispose' | 'total';

export class PerformanceMeasurementBuffer {
  readonly length: number;
  private readonly loadNanoseconds: BigUint64Array;
  private readonly exerciseNanoseconds: BigUint64Array;
  private readonly disposeNanoseconds: BigUint64Array;
  private readonly checksums: Uint32Array;
  private readonly deliveredEvents: Float64Array;

  constructor(length: number) {
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new Error('Performance measurement buffer length must be a positive safe integer.');
    }
    this.length = length;
    this.loadNanoseconds = new BigUint64Array(length);
    this.exerciseNanoseconds = new BigUint64Array(length);
    this.disposeNanoseconds = new BigUint64Array(length);
    this.checksums = new Uint32Array(length);
    this.deliveredEvents = new Float64Array(length);
  }

  set(
    index: number,
    loadNanoseconds: bigint,
    exerciseNanoseconds: bigint,
    disposeNanoseconds: bigint,
    checksum: number,
    deliveredEvents: number,
  ): void {
    this.assertIndex(index);
    this.loadNanoseconds[index] = loadNanoseconds;
    this.exerciseNanoseconds[index] = exerciseNanoseconds;
    this.disposeNanoseconds[index] = disposeNanoseconds;
    this.checksums[index] = checksum;
    this.deliveredEvents[index] = deliveredEvents;
  }

  timingAt(index: number, kind: TimingKind): bigint {
    this.assertIndex(index);
    const load = this.loadNanoseconds[index]!;
    const exercise = this.exerciseNanoseconds[index]!;
    const dispose = this.disposeNanoseconds[index]!;
    if (kind === 'load') return load;
    if (kind === 'exercise') return exercise;
    if (kind === 'dispose') return dispose;
    return load + exercise + dispose;
  }

  toRecords(runId: string): PerformanceRecord[] {
    return Array.from({ length: this.length }, (_, index) => {
      const loadNanoseconds = this.timingAt(index, 'load');
      const exerciseNanoseconds = this.timingAt(index, 'exercise');
      const disposeNanoseconds = this.timingAt(index, 'dispose');
      const cycle = index + 1;
      return {
        cycle,
        ownerId: `${runId}-measured-${cycle}`,
        loadNanoseconds: loadNanoseconds.toString(),
        exerciseNanoseconds: exerciseNanoseconds.toString(),
        disposeNanoseconds: disposeNanoseconds.toString(),
        measuredTotalNanoseconds: (
          loadNanoseconds + exerciseNanoseconds + disposeNanoseconds
        ).toString(),
        checksum: this.checksums[index]!,
        deliveredEvents: this.deliveredEvents[index]!,
      };
    });
  }

  private assertIndex(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) {
      throw new Error(`Performance measurement index ${index} is outside the fixed buffer.`);
    }
  }
}

function medianNanoseconds(values: bigint[]): bigint {
  values.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle]!;
  return (values[middle - 1]! + values[middle]!) / 2n;
}

function blockMedian(
  measurements: PerformanceMeasurementBuffer,
  startIndex: number,
  endIndex: number,
  kind: TimingKind,
): string {
  const values: bigint[] = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    values.push(measurements.timingAt(index, kind));
  }
  return medianNanoseconds(values).toString();
}

export function createPerformanceStabilityDiagnostics(
  measurements: PerformanceMeasurementBuffer,
): PerformanceStabilityDiagnostics {
  const blockCount = Math.min(10, measurements.length);
  const blocks = Array.from({ length: blockCount }, (_, blockIndex) => {
    const startIndex = Math.floor((blockIndex * measurements.length) / blockCount);
    const endIndex = Math.floor(((blockIndex + 1) * measurements.length) / blockCount);
    return {
      startCycle: startIndex + 1,
      endCycle: endIndex,
      medianLoadNanoseconds: blockMedian(measurements, startIndex, endIndex, 'load'),
      medianExerciseNanoseconds: blockMedian(measurements, startIndex, endIndex, 'exercise'),
      medianDisposeNanoseconds: blockMedian(measurements, startIndex, endIndex, 'dispose'),
      medianMeasuredTotalNanoseconds: blockMedian(measurements, startIndex, endIndex, 'total'),
    };
  });
  return { blockCount, blocks };
}

export function createMemoryDiagnostics(records: readonly MemoryRecord[]): MemoryDiagnostics {
  const baseline = records[0];
  if (!baseline || baseline.checkpointCycle !== 0) {
    throw new Error('Memory diagnostics require checkpoint 0 as the first raw record.');
  }
  return {
    baselineCheckpointCycle: 0,
    checkpointDeltas: records.map((record) => ({
      checkpointCycle: record.checkpointCycle,
      heapUsedDeltaFromBaseline: record.heapUsed - baseline.heapUsed,
      rssDeltaFromBaseline: record.rss - baseline.rss,
      externalDeltaFromBaseline: record.external - baseline.external,
      arrayBuffersDeltaFromBaseline: record.arrayBuffers - baseline.arrayBuffers,
    })),
  };
}
