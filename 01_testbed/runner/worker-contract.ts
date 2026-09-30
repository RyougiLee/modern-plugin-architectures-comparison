import type {
  BenchmarkPhase,
  BenchmarkSuite,
  FrameworkName,
  GitMetadata,
  MemoryParameters,
  PerformanceParameters,
  RunArtifact,
} from '../shared/types.js';

export interface WorkerRequest {
  experimentId: string;
  runId: string;
  phase: BenchmarkPhase;
  suite: BenchmarkSuite;
  framework: FrameworkName;
  replicate: number;
  gitMetadata: GitMetadata;
  parameters: PerformanceParameters | MemoryParameters;
}

export interface WorkerResponse {
  artifact: RunArtifact;
}
