import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type {
  BenchmarkPhase,
  BenchmarkSuite,
  FrameworkName,
  GitMetadata,
  MemoryParameters,
  PerformanceParameters,
  RunArtifact,
} from '../shared/types.js';
import { assertFinalGitState } from './metadata.js';
import type { WorkerRequest, WorkerResponse } from './worker-contract.js';

const MAX_WORKER_OUTPUT_BYTES = 64 * 1024 * 1024;

export class WorkerProcessError extends Error {
  readonly exitCode: number | null;
  readonly portableErrorName: string;
  readonly portableMessage: string;

  constructor(runId: string, exitCode: number | null, workerStderr: string) {
    const detail = workerStderr.trim();
    super(
      `Worker ${runId} exited with code ${exitCode ?? 'unknown'}${detail ? `:\n${detail}` : '.'}`,
    );
    this.name = 'WorkerProcessError';
    this.exitCode = exitCode;
    const firstLine = detail.split(/\r?\n/, 1)[0]?.trim();
    const parsed = firstLine?.match(/^([A-Za-z][A-Za-z0-9_.-]*):\s*(.*)$/);
    this.portableErrorName = parsed?.[1] ?? 'WorkerProcessError';
    this.portableMessage = parsed?.[2] || firstLine || `Worker exited with code ${exitCode ?? 'unknown'}.`;
  }
}

export function createExperimentId(phase: BenchmarkPhase): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `${phase}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

export function createRunId(
  experimentId: string,
  suite: BenchmarkSuite,
  framework: FrameworkName,
  replicate: number,
): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `${experimentId}-${suite}-${framework}-r${replicate}-${timestamp}-${randomUUID()}`;
}

export function createWorkerRequest(
  experimentId: string,
  suite: BenchmarkSuite,
  framework: FrameworkName,
  phase: BenchmarkPhase,
  replicate: number,
  parameters: PerformanceParameters | MemoryParameters,
  gitMetadata: GitMetadata,
): WorkerRequest {
  return {
    experimentId,
    runId: createRunId(experimentId, suite, framework, replicate),
    phase,
    suite,
    framework,
    replicate,
    gitMetadata,
    parameters,
  };
}

export async function runFreshProcess(request: WorkerRequest): Promise<RunArtifact> {
  assertFinalGitState(request.phase, request.gitMetadata);
  const workerPath = fileURLToPath(new URL('./worker.js', import.meta.url));
  const encodedRequest = Buffer.from(JSON.stringify(request)).toString('base64url');
  const exposeGc =
    request.suite === 'memory' && (request.parameters as MemoryParameters).forceGc;
  const nodeArguments = [...(exposeGc ? ['--expose-gc'] : []), workerPath, encodedRequest];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArguments, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_WORKER_OUTPUT_BYTES) {
        child.kill();
        reject(new Error(`Worker output exceeded ${MAX_WORKER_OUTPUT_BYTES} bytes.`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new WorkerProcessError(
            request.runId,
            code,
            Buffer.concat(stderr).toString('utf8'),
          ),
        );
        return;
      }

      try {
        const response = JSON.parse(Buffer.concat(stdout).toString('utf8')) as WorkerResponse;
        if (response.artifact.manifest.runId !== request.runId) {
          throw new Error('Worker response run ID does not match its request.');
        }
        resolve(response.artifact);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function frameworkSchedule(
  frameworks: FrameworkName[],
  replicates: number,
): Array<{ framework: FrameworkName; replicate: number }> {
  const schedule: Array<{ framework: FrameworkName; replicate: number }> = [];
  for (let replicate = 1; replicate <= replicates; replicate += 1) {
    const order = replicate % 2 === 0 ? [...frameworks].reverse() : frameworks;
    for (const framework of order) schedule.push({ framework, replicate });
  }
  return schedule;
}
