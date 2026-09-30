import type { FrameworkName, WorkloadParameters } from '../shared/types.js';

export interface HeapDiagnosticParameters extends WorkloadParameters {
  warmupCycles: number;
  lifecycleCycles: number;
}

export interface HeapDiagnosticValidation {
  warmupCyclesCompleted: number;
  completedCycles: number;
  checksumsVerified: boolean;
  registrationsVerified: boolean;
  expectedSubscriptionsPerPlugin: number;
  maximumObservedSubscriptions: number;
  resourcesReleased: boolean;
}

export interface HeapDiagnosticManifest {
  schemaVersion: 1;
  diagnosticId: string;
  createdAt: string;
  framework: FrameworkName;
  nodeVersion: string;
  packageVersions: Record<string, string>;
  gitCommit: string | null;
  workingTreeDirty: boolean | null;
  packageLockSha256: string;
  parameters: HeapDiagnosticParameters;
  forcedGc: true;
  snapshotPaths: {
    baseline: string;
    final: string;
  };
  analysisPath: string;
  validation: HeapDiagnosticValidation;
}

export interface HeapCategorySummary {
  nodeType: string;
  constructorOrCategory: string;
  baselineCount: number;
  finalCount: number;
  countDelta: number;
  baselineShallowSize: number;
  finalShallowSize: number;
  shallowSizeDelta: number;
}

export interface HeapSnapshotComparison {
  schemaVersion: 1;
  diagnosticId: string;
  framework: FrameworkName;
  baselineSnapshot: string;
  finalSnapshot: string;
  topPositiveShallowSizeDeltas: HeapCategorySummary[];
  trackedLifecycleCategories: HeapCategorySummary[];
  disposedPluginInstances: {
    constructorName: string;
    baselineCount: number;
    finalCount: number;
    countDelta: number;
  };
  retentionPathAnalysis: 'not-computed';
}
