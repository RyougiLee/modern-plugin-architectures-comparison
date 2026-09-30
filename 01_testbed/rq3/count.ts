import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Framework = 'nestjs' | 'cordis';
type Category = 'plugin-lifecycle' | 'framework-orchestration' | 'cleanup';
type CleanupActionKind = 'nominal' | 'host-shutdown' | 'failure-recovery';

interface FileDefinition {
  framework: Framework;
  path: string;
}

export interface Rq3Counts {
  pluginLifecycleSloc: number;
  frameworkSpecificLifecycleOrchestrationSloc: number;
  cleanupSloc: number;
  nominalPluginCleanupActions: number;
  hostShutdownCleanupActions: number;
  failureRecoveryCleanupActions: number;
  countedFiles: string[];
}

export interface Rq3Report {
  schemaVersion: 2;
  countingRuleVersion: 'rq3-sloc-v2';
  ruleDocument: 'spec/rq3_counting_rule.md';
  frameworks: Record<Framework, Rq3Counts>;
}

const FILES: FileDefinition[] = [
  { framework: 'nestjs', path: 'nestjs-app/nestjs-adapter.ts' },
  { framework: 'cordis', path: 'cordis-app/cordis-adapter.ts' },
];

const markerPattern = /^\s*\/\/\s*rq3:(plugin-lifecycle|framework-orchestration|cleanup):(start|end)\s*$/;
const cleanupActionPattern = /rq3:cleanup-action:(nominal|host-shutdown|failure-recovery)\b/;

function emptyCounts(): Rq3Counts {
  return {
    pluginLifecycleSloc: 0,
    frameworkSpecificLifecycleOrchestrationSloc: 0,
    cleanupSloc: 0,
    nominalPluginCleanupActions: 0,
    hostShutdownCleanupActions: 0,
    failureRecoveryCleanupActions: 0,
    countedFiles: [],
  };
}

async function countFile(definition: FileDefinition, counts: Rq3Counts): Promise<void> {
  const source = await readFile(resolve(process.cwd(), definition.path), 'utf8');
  const active = new Set<Category>();
  let insideBlockComment = false;
  counts.countedFiles.push(definition.path);

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const marker = line.match(markerPattern);
    if (marker) {
      const category = marker[1] as Category;
      const operation = marker[2];
      if (operation === 'start') {
        if (active.has(category)) {
          throw new Error(`${definition.path}:${index + 1} starts active ${category} region.`);
        }
        active.add(category);
      } else if (!active.delete(category)) {
        throw new Error(`${definition.path}:${index + 1} ends inactive ${category} region.`);
      }
      continue;
    }

    let code = '';
    let cursor = 0;
    while (cursor < line.length) {
      if (insideBlockComment) {
        const blockEnd = line.indexOf('*/', cursor);
        if (blockEnd === -1) break;
        insideBlockComment = false;
        cursor = blockEnd + 2;
        continue;
      }
      const lineComment = line.indexOf('//', cursor);
      const blockStart = line.indexOf('/*', cursor);
      if (lineComment !== -1 && (blockStart === -1 || lineComment < blockStart)) {
        code += line.slice(cursor, lineComment);
        break;
      }
      if (blockStart !== -1) {
        code += line.slice(cursor, blockStart);
        insideBlockComment = true;
        cursor = blockStart + 2;
        continue;
      }
      code += line.slice(cursor);
      break;
    }
    code = code.trim();
    if (code.length === 0 || code.startsWith('import ')) continue;
    if (active.has('plugin-lifecycle')) counts.pluginLifecycleSloc += 1;
    if (active.has('framework-orchestration')) {
      counts.frameworkSpecificLifecycleOrchestrationSloc += 1;
    }
    if (active.has('cleanup')) counts.cleanupSloc += 1;
    const cleanupAction = line.match(cleanupActionPattern);
    if (line.includes('rq3:cleanup-action') && !cleanupAction) {
      throw new Error(`${definition.path}:${index + 1} has an invalid cleanup-action marker.`);
    }
    if (cleanupAction) {
      if (!active.has('cleanup')) {
        throw new Error(`${definition.path}:${index + 1} cleanup action is outside cleanup region.`);
      }
      const kind = cleanupAction[1] as CleanupActionKind;
      if (kind === 'nominal') counts.nominalPluginCleanupActions += 1;
      if (kind === 'host-shutdown') counts.hostShutdownCleanupActions += 1;
      if (kind === 'failure-recovery') counts.failureRecoveryCleanupActions += 1;
    }
  }

  if (active.size > 0) {
    throw new Error(`${definition.path} has unclosed RQ3 region(s): ${[...active].join(', ')}.`);
  }
  if (insideBlockComment) throw new Error(`${definition.path} has an unclosed block comment.`);
}

export async function countRq3(): Promise<Rq3Report> {
  const frameworks: Record<Framework, Rq3Counts> = {
    nestjs: emptyCounts(),
    cordis: emptyCounts(),
  };
  for (const definition of FILES) {
    await countFile(definition, frameworks[definition.framework]);
  }

  return {
    schemaVersion: 2,
    countingRuleVersion: 'rq3-sloc-v2',
    ruleDocument: 'spec/rq3_counting_rule.md',
    frameworks,
  };
}

async function main(): Promise<void> {
  process.stdout.write(`${JSON.stringify(await countRq3(), null, 2)}\n`);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
