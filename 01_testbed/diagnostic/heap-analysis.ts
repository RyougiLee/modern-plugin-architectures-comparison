import { readFile } from 'node:fs/promises';

import type { FrameworkName } from '../shared/types.js';
import type {
  HeapCategorySummary,
  HeapSnapshotComparison,
} from './heap-types.js';

interface RawHeapSnapshot {
  snapshot: {
    meta: {
      node_fields: string[];
      node_types: Array<string[] | string>;
    };
  };
  nodes: number[];
  strings: string[];
}

interface CategoryAggregate {
  nodeType: string;
  constructorOrCategory: string;
  count: number;
  shallowSize: number;
}

const TRACKED_NAMES = [
  'BenchmarkPlugin',
  'DeterministicWorkload',
  'InstanceWrapper',
  'Context',
  'Fork',
  'Map',
  'Set',
  'Array',
  'closure',
  'owner/plugin ID string',
];

function fieldIndex(fields: string[], name: string): number {
  const index = fields.indexOf(name);
  if (index < 0) throw new Error(`Heap snapshot node field ${name} is missing.`);
  return index;
}

function normalizedCategoryName(
  nodeType: string,
  name: string,
  diagnosticId: string,
): string {
  if (nodeType.includes('string') && name.includes(diagnosticId)) {
    return 'owner/plugin ID string';
  }
  return name || '(anonymous)';
}

async function summarizeSnapshot(
  path: string,
  diagnosticId: string,
): Promise<Map<string, CategoryAggregate>> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as RawHeapSnapshot;
  const fields = parsed.snapshot.meta.node_fields;
  const stride = fields.length;
  const typeOffset = fieldIndex(fields, 'type');
  const nameOffset = fieldIndex(fields, 'name');
  const sizeOffset = fieldIndex(fields, 'self_size');
  const typeNames = parsed.snapshot.meta.node_types[typeOffset];
  if (!Array.isArray(typeNames)) throw new Error('Heap snapshot node type names are missing.');

  const categories = new Map<string, CategoryAggregate>();
  for (let offset = 0; offset < parsed.nodes.length; offset += stride) {
    const nodeType = typeNames[parsed.nodes[offset + typeOffset]!] ?? 'unknown';
    const rawName = parsed.strings[parsed.nodes[offset + nameOffset]!] ?? '(missing)';
    const constructorOrCategory = normalizedCategoryName(nodeType, rawName, diagnosticId);
    const key = `${nodeType}\u0000${constructorOrCategory}`;
    const existing = categories.get(key);
    if (existing) {
      existing.count += 1;
      existing.shallowSize += parsed.nodes[offset + sizeOffset]!;
    } else {
      categories.set(key, {
        nodeType,
        constructorOrCategory,
        count: 1,
        shallowSize: parsed.nodes[offset + sizeOffset]!,
      });
    }
  }
  return categories;
}

function compareCategory(
  baseline: CategoryAggregate | undefined,
  final: CategoryAggregate | undefined,
): HeapCategorySummary {
  const nodeType = final?.nodeType ?? baseline?.nodeType ?? 'unknown';
  const constructorOrCategory =
    final?.constructorOrCategory ?? baseline?.constructorOrCategory ?? '(unknown)';
  const baselineCount = baseline?.count ?? 0;
  const finalCount = final?.count ?? 0;
  const baselineShallowSize = baseline?.shallowSize ?? 0;
  const finalShallowSize = final?.shallowSize ?? 0;
  return {
    nodeType,
    constructorOrCategory,
    baselineCount,
    finalCount,
    countDelta: finalCount - baselineCount,
    baselineShallowSize,
    finalShallowSize,
    shallowSizeDelta: finalShallowSize - baselineShallowSize,
  };
}

export async function compareHeapSnapshots(
  diagnosticId: string,
  framework: FrameworkName,
  baselinePath: string,
  finalPath: string,
  baselinePortablePath: string,
  finalPortablePath: string,
): Promise<HeapSnapshotComparison> {
  const baseline = await summarizeSnapshot(baselinePath, diagnosticId);
  const final = await summarizeSnapshot(finalPath, diagnosticId);
  const keys = new Set([...baseline.keys(), ...final.keys()]);
  const comparisons = [...keys].map((key) => compareCategory(baseline.get(key), final.get(key)));
  const topPositiveShallowSizeDeltas = comparisons
    .filter(({ shallowSizeDelta, countDelta }) => shallowSizeDelta > 0 || countDelta > 0)
    .sort(
      (left, right) =>
        right.shallowSizeDelta - left.shallowSizeDelta || right.countDelta - left.countDelta,
    )
    .slice(0, 40);
  const trackedLifecycleCategories = comparisons
    .filter(({ nodeType, constructorOrCategory }) =>
      TRACKED_NAMES.some(
        (name) =>
          nodeType.toLowerCase().includes(name.toLowerCase()) ||
          constructorOrCategory.toLowerCase().includes(name.toLowerCase()),
      ),
    )
    .filter(({ countDelta, shallowSizeDelta }) => countDelta !== 0 || shallowSizeDelta !== 0)
    .sort((left, right) => right.shallowSizeDelta - left.shallowSizeDelta)
    .slice(0, 100);
  const pluginConstructor =
    framework === 'nestjs' ? 'NestjsBenchmarkPlugin' : 'CordisBenchmarkPlugin';
  const pluginCategory = comparisons.find(
    ({ nodeType, constructorOrCategory }) =>
      nodeType === 'object' && constructorOrCategory === pluginConstructor,
  );

  return {
    schemaVersion: 1,
    diagnosticId,
    framework,
    baselineSnapshot: baselinePortablePath,
    finalSnapshot: finalPortablePath,
    topPositiveShallowSizeDeltas,
    trackedLifecycleCategories,
    disposedPluginInstances: {
      constructorName: pluginConstructor,
      baselineCount: pluginCategory?.baselineCount ?? 0,
      finalCount: pluginCategory?.finalCount ?? 0,
      countDelta: pluginCategory?.countDelta ?? 0,
    },
    retentionPathAnalysis: 'not-computed',
  };
}
