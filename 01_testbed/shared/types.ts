export type FrameworkName = 'nestjs' | 'cordis';
export type BenchmarkSuite = 'performance' | 'memory';
export type BenchmarkPhase = 'pilot' | 'exploratory' | 'final';

export interface WorkloadParameters {
  payloadSizeBytes: number;
  subscriptionCount: number;
  eventCount: number;
}

export interface WorkloadSpec extends WorkloadParameters {
  ownerId: string;
  pluginOrdinal: number;
  expectedChecksum: number;
}

export interface WorkloadResult {
  checksum: number;
  expectedChecksum: number;
  deliveredEvents: number;
}

export interface LedgerOwnerSnapshot {
  ownerId: string;
  activeSubscriptions: number;
  totalActiveResources: number;
}

export interface ResourceLedgerSnapshot {
  activeSubscriptions: number;
  totalActiveResources: number;
  owners: LedgerOwnerSnapshot[];
}

export interface LifecycleAdapter {
  readonly framework: FrameworkName;
  initialize(): Promise<void>;
  load(spec: WorkloadSpec): Promise<number>;
  exercise(): WorkloadResult;
  dispose(): Promise<void>;
  ledgerSnapshot(): ResourceLedgerSnapshot;
  close(): Promise<void>;
}

export interface PerformanceParameters extends WorkloadParameters {
  warmupCycles: number;
  measuredCycles: number;
}

export interface MemoryParameters extends WorkloadParameters {
  memoryWarmupCycles: number;
  lifecycleCycles: number;
  checkpoints: number[];
  forceGc: boolean;
}

export interface PerformanceRecord {
  cycle: number;
  ownerId: string;
  loadNanoseconds: string;
  exerciseNanoseconds: string;
  disposeNanoseconds: string;
  measuredTotalNanoseconds: string;
  checksum: number;
  deliveredEvents: number;
}

export interface MemoryRecord {
  checkpointCycle: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  ledger: ResourceLedgerSnapshot;
  forcedGc: boolean;
}

export interface PerformanceStabilityBlock {
  startCycle: number;
  endCycle: number;
  medianLoadNanoseconds: string;
  medianExerciseNanoseconds: string;
  medianDisposeNanoseconds: string;
  medianMeasuredTotalNanoseconds: string;
}

export interface PerformanceStabilityDiagnostics {
  blockCount: number;
  blocks: PerformanceStabilityBlock[];
}

export interface MemoryCheckpointDelta {
  checkpointCycle: number;
  heapUsedDeltaFromBaseline: number;
  rssDeltaFromBaseline: number;
  externalDeltaFromBaseline: number;
  arrayBuffersDeltaFromBaseline: number;
}

export interface MemoryDiagnostics {
  baselineCheckpointCycle: 0;
  checkpointDeltas: MemoryCheckpointDelta[];
}

export interface RunManifest {
  schemaVersion: 2;
  experimentId: string;
  runId: string;
  createdAt: string;
  phase: BenchmarkPhase;
  suite: BenchmarkSuite;
  framework: FrameworkName;
  scenario: 'nominal';
  replicate: number;
  nodeVersion: string;
  packageVersions: Record<string, string>;
  operatingSystem: {
    platform: NodeJS.Platform;
    release: string;
    architecture: string;
    cpuModel: string | null;
    logicalCpuCount: number;
  };
  gitCommit: string | null;
  workingTreeDirty: boolean | null;
  packageLockSha256: string;
  parameters: PerformanceParameters | MemoryParameters;
  forcedGc: boolean;
}

export interface GitMetadata {
  gitCommit: string | null;
  workingTreeDirty: boolean | null;
  gitRepositoryRoot: string | null;
}

export interface RunArtifact {
  manifest: RunManifest;
  records: PerformanceRecord[] | MemoryRecord[];
  stabilityDiagnostics?: PerformanceStabilityDiagnostics;
  memoryDiagnostics?: MemoryDiagnostics;
  validation: {
    completedCycles: number;
    expectedCycles: number;
    warmupCyclesCompleted: number;
    checksumsVerified: boolean;
    registrationsVerified: boolean;
    expectedSubscriptionsPerPlugin: number;
    maximumObservedSubscriptions: number;
    resourcesReleased: boolean;
  };
}
