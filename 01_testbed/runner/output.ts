import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { RunArtifact } from '../shared/types.js';

export const RAW_SCHEMA_DIRECTORY = 'schema-v2';

export function experimentOutputDirectory(
  outputRoot: string,
  phase: RunArtifact['manifest']['phase'],
  experimentId: string,
): string {
  return resolve(outputRoot, phase, RAW_SCHEMA_DIRECTORY, experimentId);
}

export async function writeRunArtifact(
  artifact: RunArtifact,
  outputRoot = resolve(process.cwd(), 'results'),
): Promise<string> {
  const { phase, suite, framework, experimentId, runId } = artifact.manifest;
  const directory = resolve(
    experimentOutputDirectory(outputRoot, phase, experimentId),
    suite,
    framework,
  );
  await mkdir(directory, { recursive: true });
  const outputPath = resolve(directory, `${runId}.json`);

  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return outputPath;
}

export async function verifyRunArtifactFile(path: string, expectedRunId: string): Promise<void> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as RunArtifact;
  const timingStructureValid =
    parsed.manifest.suite !== 'performance' ||
    parsed.records.every((record) => {
      if (
        !('loadNanoseconds' in record) ||
        !('exerciseNanoseconds' in record) ||
        !('disposeNanoseconds' in record) ||
        !('measuredTotalNanoseconds' in record)
      ) {
        return false;
      }
      return (
        BigInt(record.measuredTotalNanoseconds) ===
        BigInt(record.loadNanoseconds) +
          BigInt(record.exerciseNanoseconds) +
          BigInt(record.disposeNanoseconds)
      );
    });
  if (
    parsed.manifest.runId !== expectedRunId ||
    parsed.manifest.schemaVersion !== 2 ||
    !Array.isArray(parsed.records) ||
    !parsed.validation.checksumsVerified ||
    !parsed.validation.registrationsVerified ||
    !parsed.validation.resourcesReleased ||
    !timingStructureValid
  ) {
    throw new Error(`Run artifact validation failed for ${path}.`);
  }
}
