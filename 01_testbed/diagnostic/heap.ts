import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeHeapSnapshot } from 'node:v8';

import { readGitMetadata } from '../runner/metadata.js';
import { createAdapter } from '../shared/adapter-factory.js';
import {
  assertRegisteredResources,
  assertResourcesReleased,
  assertWorkloadResult,
} from '../shared/invariants.js';
import type { FrameworkName, LifecycleAdapter } from '../shared/types.js';
import { createWorkloadSpec, validateWorkloadParameters } from '../shared/workload.js';
import { compareHeapSnapshots } from './heap-analysis.js';
import {
  HEAP_DIAGNOSTIC_DEFAULTS,
  HEAP_DIAGNOSTIC_RELATIVE_OUTPUT,
} from './heap-config.js';
import {
  createHeapDiagnosticManifest,
  portableDiagnosticPath,
  readDiagnosticPackageVersions,
  readPackageLockSha256,
} from './heap-manifest.js';
import type {
  HeapDiagnosticParameters,
  HeapDiagnosticValidation,
} from './heap-types.js';

function diagnosticId(framework: FrameworkName): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `heap-${framework}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function parseFramework(args: string[]): FrameworkName {
  if (args.length !== 2 || args[0] !== '--framework' || !['nestjs', 'cordis'].includes(args[1]!)) {
    throw new Error('Usage: npm run diagnostic:heap -- --framework nestjs|cordis');
  }
  return args[1] as FrameworkName;
}

function forceGarbageCollection(): void {
  if (!globalThis.gc) {
    throw new Error('Heap diagnostics require Node.js to run with --expose-gc.');
  }
  globalThis.gc();
}

async function runLifecycleCycle(
  adapter: LifecycleAdapter,
  parameters: HeapDiagnosticParameters,
  ownerId: string,
  pluginOrdinal: number,
): Promise<number> {
  const spec = createWorkloadSpec(parameters, ownerId, pluginOrdinal);
  const expectedChecksum = await adapter.load(spec);
  const registered = assertRegisteredResources(adapter, spec);
  const result = adapter.exercise();
  assertWorkloadResult(result, spec);
  if (result.expectedChecksum !== expectedChecksum) {
    throw new Error(`Checksum changed between load and exercise for ${ownerId}.`);
  }
  await adapter.dispose();
  assertResourcesReleased(adapter, ownerId);
  return registered.activeSubscriptions;
}

export async function runHeapDiagnostic(framework: FrameworkName): Promise<string> {
  const parameters = { ...HEAP_DIAGNOSTIC_DEFAULTS };
  validateWorkloadParameters(parameters);
  const id = diagnosticId(framework);
  const projectDirectory = process.cwd();
  const outputDirectory = resolve(projectDirectory, HEAP_DIAGNOSTIC_RELATIVE_OUTPUT, id);
  await mkdir(outputDirectory, { recursive: true });
  const baselinePath = resolve(outputDirectory, `${framework}-${id}-baseline.heapsnapshot`);
  const finalPath = resolve(outputDirectory, `${framework}-${id}-final.heapsnapshot`);
  const analysisPath = resolve(outputDirectory, `${framework}-${id}-comparison.json`);
  const manifestPath = resolve(outputDirectory, `${framework}-${id}-manifest.json`);
  const adapter = createAdapter(framework);
  let warmupCyclesCompleted = 0;
  let completedCycles = 0;
  let maximumObservedSubscriptions = 0;
  let resourcesReleased = false;

  await adapter.initialize();
  try {
    for (let cycle = 1; cycle <= parameters.warmupCycles; cycle += 1) {
      maximumObservedSubscriptions = Math.max(
        maximumObservedSubscriptions,
        await runLifecycleCycle(adapter, parameters, `${id}-warmup-${cycle}`, cycle),
      );
      warmupCyclesCompleted = cycle;
    }
    forceGarbageCollection();
    writeHeapSnapshot(baselinePath);

    for (let cycle = 1; cycle <= parameters.lifecycleCycles; cycle += 1) {
      maximumObservedSubscriptions = Math.max(
        maximumObservedSubscriptions,
        await runLifecycleCycle(
          adapter,
          parameters,
          `${id}-lifecycle-${cycle}`,
          parameters.warmupCycles + cycle,
        ),
      );
      completedCycles = cycle;
    }
    forceGarbageCollection();
    writeHeapSnapshot(finalPath);
    const finalLedger = adapter.ledgerSnapshot();
    resourcesReleased =
      finalLedger.activeSubscriptions === 0 && finalLedger.totalActiveResources === 0;
  } finally {
    await adapter.close();
  }

  const validation: HeapDiagnosticValidation = {
    warmupCyclesCompleted,
    completedCycles,
    checksumsVerified: completedCycles === parameters.lifecycleCycles,
    registrationsVerified:
      completedCycles === parameters.lifecycleCycles &&
      maximumObservedSubscriptions === parameters.subscriptionCount,
    expectedSubscriptionsPerPlugin: parameters.subscriptionCount,
    maximumObservedSubscriptions,
    resourcesReleased,
  };
  const baselinePortablePath = portableDiagnosticPath(outputDirectory, baselinePath);
  const finalPortablePath = portableDiagnosticPath(outputDirectory, finalPath);
  const comparison = await compareHeapSnapshots(
    id,
    framework,
    baselinePath,
    finalPath,
    baselinePortablePath,
    finalPortablePath,
  );
  await writeFile(analysisPath, `${JSON.stringify(comparison, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });

  const manifest = createHeapDiagnosticManifest({
    diagnosticId: id,
    framework,
    packageVersions: await readDiagnosticPackageVersions(projectDirectory),
    gitMetadata: readGitMetadata(projectDirectory),
    packageLockSha256: await readPackageLockSha256(projectDirectory),
    parameters,
    baselineSnapshotPath: baselinePath,
    finalSnapshotPath: finalPath,
    analysisPath,
    outputDirectory,
    validation,
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return manifestPath;
}

async function main(): Promise<void> {
  const framework = parseFramework(process.argv.slice(2));
  const manifestPath = await runHeapDiagnostic(framework);
  process.stdout.write(`Heap diagnostic completed: ${manifestPath}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
