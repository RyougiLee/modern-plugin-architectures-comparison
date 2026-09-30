import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

import type { GitMetadata } from '../shared/types.js';
import type {
  HeapDiagnosticManifest,
  HeapDiagnosticParameters,
  HeapDiagnosticValidation,
} from './heap-types.js';
import type { FrameworkName } from '../shared/types.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function portableDiagnosticPath(directory: string, artifactPath: string): string {
  const portable = relative(directory, artifactPath);
  const segments = portable.split(sep);
  if (
    !isAbsolute(artifactPath) ||
    portable.length === 0 ||
    isAbsolute(portable) ||
    segments[0] === '..'
  ) {
    throw new Error(`Diagnostic artifact must be inside its output directory: ${artifactPath}`);
  }
  return segments.join('/');
}

export async function readDiagnosticPackageVersions(
  projectDirectory: string,
): Promise<Record<string, string>> {
  const parsed = JSON.parse(
    await readFile(`${projectDirectory}/package.json`, 'utf8'),
  ) as PackageJson;
  return { ...parsed.dependencies, ...parsed.devDependencies };
}

export async function readPackageLockSha256(projectDirectory: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(`${projectDirectory}/package-lock.json`))
    .digest('hex');
}

export interface CreateHeapDiagnosticManifestOptions {
  diagnosticId: string;
  framework: FrameworkName;
  packageVersions: Record<string, string>;
  gitMetadata: GitMetadata;
  packageLockSha256: string;
  parameters: HeapDiagnosticParameters;
  baselineSnapshotPath: string;
  finalSnapshotPath: string;
  analysisPath: string;
  outputDirectory: string;
  validation: HeapDiagnosticValidation;
  createdAt?: string;
}

export function createHeapDiagnosticManifest(
  options: CreateHeapDiagnosticManifestOptions,
): HeapDiagnosticManifest {
  return {
    schemaVersion: 1,
    diagnosticId: options.diagnosticId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    framework: options.framework,
    nodeVersion: process.version,
    packageVersions: options.packageVersions,
    gitCommit: options.gitMetadata.gitCommit,
    workingTreeDirty: options.gitMetadata.workingTreeDirty,
    packageLockSha256: options.packageLockSha256,
    parameters: options.parameters,
    forcedGc: true,
    snapshotPaths: {
      baseline: portableDiagnosticPath(options.outputDirectory, options.baselineSnapshotPath),
      final: portableDiagnosticPath(options.outputDirectory, options.finalSnapshotPath),
    },
    analysisPath: portableDiagnosticPath(options.outputDirectory, options.analysisPath),
    validation: options.validation,
  };
}
