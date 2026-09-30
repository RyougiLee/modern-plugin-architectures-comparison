import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { BenchmarkPhase, BenchmarkSuite, FrameworkName } from '../shared/types.js';
import { experimentOutputDirectory } from './output.js';

export interface PlannedBatchRun {
  runId: string;
  suite: BenchmarkSuite;
  framework: FrameworkName;
  replicate: number;
}

export interface BatchFailureSummary {
  exitCode: number | null;
  errorName: string;
  message: string;
}

interface BatchRunRecord extends PlannedBatchRun {
  status: 'planned' | 'completed' | 'failed';
  artifactPath: string | null;
  failure: BatchFailureSummary | null;
}

export interface BatchManifest {
  schemaVersion: 2;
  experimentId: string;
  phase: BenchmarkPhase;
  createdAt: string;
  updatedAt: string;
  behaviorOnFailure: 'stop';
  plannedRunCount: number;
  completedRunCount: number;
  failedRunCount: number;
  incompleteRunCount: number;
  status: 'running' | 'completed' | 'failed';
  batchFailure: BatchFailureSummary | null;
  runs: BatchRunRecord[];
}

function sanitizeMessage(message: string): string {
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() || 'Unspecified failure.';
  return firstLine
    .replace(/file:\/\/\/[A-Za-z]:\/.*$/i, '<local-path>')
    .replace(/[A-Za-z]:[\\/].*$/, '<local-path>')
    .replace(/\/(?:Users|home|tmp|var|workspace)\/.*$/, '<local-path>')
    .slice(0, 300);
}

export function summarizeFailure(error: unknown): BatchFailureSummary {
  const candidate = error as {
    exitCode?: unknown;
    portableErrorName?: unknown;
    portableMessage?: unknown;
  };
  const rawName =
    typeof candidate?.portableErrorName === 'string'
      ? candidate.portableErrorName
      : error instanceof Error
        ? error.name
        : 'Error';
  const rawMessage =
    typeof candidate?.portableMessage === 'string'
      ? candidate.portableMessage
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    exitCode: typeof candidate?.exitCode === 'number' ? candidate.exitCode : null,
    errorName: /^[A-Za-z][A-Za-z0-9_.-]*$/.test(rawName) ? rawName : 'Error',
    message: sanitizeMessage(rawMessage),
  };
}

export class BatchTracker {
  readonly path: string;
  private readonly manifest: BatchManifest;

  private constructor(path: string, manifest: BatchManifest) {
    this.path = path;
    this.manifest = manifest;
  }

  static async create(
    outputRoot: string,
    experimentId: string,
    phase: BenchmarkPhase,
    plannedRuns: PlannedBatchRun[],
  ): Promise<BatchTracker> {
    const directory = experimentOutputDirectory(outputRoot, phase, experimentId);
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, 'batch-manifest.json');
    const now = new Date().toISOString();
    const manifest: BatchManifest = {
      schemaVersion: 2,
      experimentId,
      phase,
      createdAt: now,
      updatedAt: now,
      behaviorOnFailure: 'stop',
      plannedRunCount: plannedRuns.length,
      completedRunCount: 0,
      failedRunCount: 0,
      incompleteRunCount: plannedRuns.length,
      status: 'running',
      batchFailure: null,
      runs: plannedRuns.map((run) => ({
        ...run,
        status: 'planned',
        artifactPath: null,
        failure: null,
      })),
    };
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return new BatchTracker(path, manifest);
  }

  async markCompleted(runId: string, artifactPath: string): Promise<void> {
    const run = this.findRun(runId);
    const relativePath = relative(dirname(this.path), artifactPath);
    const pathSegments = relativePath.split(sep);
    if (
      !isAbsolute(artifactPath) ||
      relativePath.length === 0 ||
      isAbsolute(relativePath) ||
      pathSegments[0] === '..'
    ) {
      throw new Error(`Artifact path must be inside the batch directory: ${artifactPath}`);
    }
    run.status = 'completed';
    run.artifactPath = pathSegments.join('/');
    this.recalculate();
    await this.persist();
  }

  async markFailed(runId: string, error: unknown): Promise<void> {
    const run = this.findRun(runId);
    run.status = 'failed';
    run.failure = summarizeFailure(error);
    this.recalculate();
    this.manifest.status = 'failed';
    await this.persist();
  }

  async markCompletedBatch(): Promise<void> {
    this.recalculate();
    if (this.manifest.incompleteRunCount !== 0 || this.manifest.failedRunCount !== 0) {
      throw new Error('Cannot complete a batch with failed or incomplete runs.');
    }
    this.manifest.status = 'completed';
    await this.persist();
  }

  async markBatchFailed(error: unknown): Promise<void> {
    this.recalculate();
    this.manifest.status = 'failed';
    this.manifest.batchFailure = summarizeFailure(error);
    await this.persist();
  }

  snapshot(): BatchManifest {
    return structuredClone(this.manifest);
  }

  private findRun(runId: string): BatchRunRecord {
    const run = this.manifest.runs.find((candidate) => candidate.runId === runId);
    if (!run) throw new Error(`Unknown batch run ID ${runId}.`);
    if (run.status !== 'planned') throw new Error(`Batch run ${runId} is already ${run.status}.`);
    return run;
  }

  private recalculate(): void {
    this.manifest.completedRunCount = this.manifest.runs.filter(
      ({ status }) => status === 'completed',
    ).length;
    this.manifest.failedRunCount = this.manifest.runs.filter(
      ({ status }) => status === 'failed',
    ).length;
    this.manifest.incompleteRunCount = this.manifest.runs.filter(
      ({ status }) => status === 'planned',
    ).length;
  }

  private async persist(): Promise<void> {
    this.manifest.updatedAt = new Date().toISOString();
    await writeFile(this.path, `${JSON.stringify(this.manifest, null, 2)}\n`, 'utf8');
  }
}
