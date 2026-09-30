import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus, arch, platform, release } from 'node:os';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { BenchmarkPhase, GitMetadata, MemoryParameters, RunManifest } from '../shared/types.js';
import type { WorkerRequest } from './worker-contract.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function packageVersions(): Promise<Record<string, string>> {
  const packagePath = resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as PackageJson;
  return {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
}

export type GitCommandRunner = (arguments_: string[], cwd: string) => string;

const defaultGitCommandRunner: GitCommandRunner = (arguments_, cwd) =>
  execFileSync('git', arguments_, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

export function readGitMetadata(
  cwd = process.cwd(),
  runGit: GitCommandRunner = defaultGitCommandRunner,
): GitMetadata {
  try {
    const gitRepositoryRoot = runGit(['rev-parse', '--show-toplevel'], cwd).trim();
    const gitCommit = runGit(['rev-parse', 'HEAD'], cwd).trim();
    const workingTreeDirty = runGit(
      ['status', '--porcelain', '--untracked-files=normal'],
      cwd,
    ).trim().length > 0;
    return { gitCommit, workingTreeDirty, gitRepositoryRoot };
  } catch {
    return {
      gitCommit: null,
      workingTreeDirty: null,
      gitRepositoryRoot: null,
    };
  }
}

export function assertFinalGitState(phase: BenchmarkPhase, metadata: GitMetadata): void {
  if (phase !== 'final') return;
  if (!metadata.gitRepositoryRoot || !metadata.gitCommit || metadata.workingTreeDirty === null) {
    throw new Error(
      'Final run rejected: the testbed is not inside a usable Git repository or its commit/state could not be determined.',
    );
  }
  if (metadata.workingTreeDirty) {
    throw new Error('Final run rejected: the Git working tree is dirty. Commit or clean all changes first.');
  }
}

async function packageLockSha256(): Promise<string> {
  const lockPath = resolve(process.cwd(), 'package-lock.json');
  return createHash('sha256').update(await readFile(lockPath)).digest('hex');
}

export async function createRunManifest(request: WorkerRequest): Promise<RunManifest> {
  const cpuList = cpus();
  const forcedGc =
    request.suite === 'memory' && (request.parameters as MemoryParameters).forceGc;

  return {
    schemaVersion: 2,
    experimentId: request.experimentId,
    runId: request.runId,
    createdAt: new Date().toISOString(),
    phase: request.phase,
    suite: request.suite,
    framework: request.framework,
    scenario: 'nominal',
    replicate: request.replicate,
    nodeVersion: process.version,
    packageVersions: await packageVersions(),
    operatingSystem: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpuModel: cpuList[0]?.model ?? null,
      logicalCpuCount: cpuList.length,
    },
    gitCommit: request.gitMetadata.gitCommit,
    workingTreeDirty: request.gitMetadata.workingTreeDirty,
    packageLockSha256: await packageLockSha256(),
    parameters: request.parameters,
    forcedGc,
  };
}
