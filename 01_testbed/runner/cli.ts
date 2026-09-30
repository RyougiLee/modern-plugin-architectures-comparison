import { resolve } from 'node:path';

import type {
  BenchmarkPhase,
  BenchmarkSuite,
  FrameworkName,
  GitMetadata,
  MemoryParameters,
  PerformanceParameters,
  PerformanceRecord,
  RunArtifact,
} from '../shared/types.js';
import { validateWorkloadParameters } from '../shared/workload.js';
import { BatchTracker } from './batch.js';
import { assertFinalGitState, readGitMetadata } from './metadata.js';
import { verifyRunArtifactFile, writeRunArtifact } from './output.js';
import {
  createExperimentId,
  createWorkerRequest,
  frameworkSchedule,
  runFreshProcess,
} from './process-runner.js';
import type { WorkerRequest } from './worker-contract.js';

interface ParsedOptions {
  framework: 'both' | FrameworkName;
  phase: BenchmarkPhase;
  replicates: number;
  outputRoot: string;
  payloadSizeBytes: number;
  subscriptionCount: number;
  eventCount: number;
  warmupCycles?: number;
  memoryWarmupCycles?: number;
  cycles?: number;
  checkpoints?: number[];
  forceGc?: boolean;
}

const HELP_TEXT = `Usage:
  node dist/runner/cli.js pilot
  node dist/runner/cli.js performance [options]
  node dist/runner/cli.js memory [options]

Common options:
  --framework both|nestjs|cordis   Default: both
  --phase pilot|exploratory|final Default: exploratory
  --replicates N                  Defaults: performance 20, memory 10
  --payload-size N                Default: 4096 bytes
  --subscriptions N               Default: 4
  --events N                      Default: 32
  --cycles N                      Default: 2000
  --output PATH                   Override the phase-aware output root

Performance option:
  --warmup N                      Default: 200 cycles

Memory options:
  --memory-warmup N               Default: 100 cycles before checkpoint 0
  --checkpoints CSV               Default: 0,100,250,500,1000,1500,2000
  --force-gc true|false           Default: true

Default output roots:
  pilot/exploratory: ./results
  final:              ../02_data/raw

Final runs are rejected unless Git commit metadata is available and the working
tree is clean. Every invocation stops on its first failed replicate and records
the failure in its batch manifest.
`;

function optionMap(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Expected command options in --name value pairs; received ${name ?? '<end>'}.`);
    }
    const normalized = name.slice(2);
    if (options.has(normalized)) throw new Error(`Option --${normalized} was provided more than once.`);
    options.set(normalized, value);
  }
  return options;
}

function integerOption(options: Map<string, string>, name: string, fallback: number): number {
  const raw = options.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative safe integer.`);
  }
  return value;
}

function defaultOutputRoot(phase: BenchmarkPhase): string {
  return phase === 'final'
    ? resolve(process.cwd(), '..', '02_data', 'raw')
    : resolve(process.cwd(), 'results');
}

function parseCommon(args: string[], suite: BenchmarkSuite): ParsedOptions {
  const options = optionMap(args);
  const allowed = new Set([
    'framework',
    'phase',
    'replicates',
    'output',
    'payload-size',
    'subscriptions',
    'events',
    'cycles',
    ...(suite === 'performance'
      ? ['warmup']
      : ['memory-warmup', 'checkpoints', 'force-gc']),
  ]);
  for (const name of options.keys()) {
    if (!allowed.has(name)) throw new Error(`Unknown ${suite} option --${name}.`);
  }

  const framework = options.get('framework') ?? 'both';
  if (!['both', 'nestjs', 'cordis'].includes(framework)) {
    throw new Error('--framework must be both, nestjs, or cordis.');
  }
  const phase = options.get('phase') ?? 'exploratory';
  if (!['pilot', 'exploratory', 'final'].includes(phase)) {
    throw new Error('--phase must be pilot, exploratory, or final.');
  }

  const typedPhase = phase as BenchmarkPhase;
  const parsed: ParsedOptions = {
    framework: framework as ParsedOptions['framework'],
    phase: typedPhase,
    replicates: integerOption(options, 'replicates', suite === 'performance' ? 20 : 10),
    outputRoot: resolve(options.get('output') ?? defaultOutputRoot(typedPhase)),
    payloadSizeBytes: integerOption(options, 'payload-size', 4096),
    subscriptionCount: integerOption(options, 'subscriptions', 4),
    eventCount: integerOption(options, 'events', 32),
  };
  if (parsed.replicates <= 0) throw new Error('--replicates must be greater than zero.');
  validateWorkloadParameters(parsed);

  if (suite === 'performance') {
    parsed.warmupCycles = integerOption(options, 'warmup', 200);
    parsed.cycles = integerOption(options, 'cycles', 2000);
  } else {
    parsed.memoryWarmupCycles = integerOption(options, 'memory-warmup', 100);
    parsed.cycles = integerOption(options, 'cycles', 2000);
    const checkpointText = options.get('checkpoints') ?? '0,100,250,500,1000,1500,2000';
    parsed.checkpoints = checkpointText.split(',').map((value) => Number(value));
    const forceGc = options.get('force-gc') ?? 'true';
    if (!['true', 'false'].includes(forceGc)) {
      throw new Error('--force-gc must be true or false.');
    }
    parsed.forceGc = forceGc === 'true';
  }
  if (parsed.cycles! <= 0) throw new Error('--cycles must be greater than zero.');
  return parsed;
}

function selectedFrameworks(option: ParsedOptions['framework']): FrameworkName[] {
  return option === 'both' ? ['nestjs', 'cordis'] : [option];
}

function performanceParameters(options: ParsedOptions): PerformanceParameters {
  return {
    payloadSizeBytes: options.payloadSizeBytes,
    subscriptionCount: options.subscriptionCount,
    eventCount: options.eventCount,
    warmupCycles: options.warmupCycles!,
    measuredCycles: options.cycles!,
  };
}

function memoryParameters(options: ParsedOptions): MemoryParameters {
  return {
    payloadSizeBytes: options.payloadSizeBytes,
    subscriptionCount: options.subscriptionCount,
    eventCount: options.eventCount,
    memoryWarmupCycles: options.memoryWarmupCycles!,
    lifecycleCycles: options.cycles!,
    checkpoints: options.checkpoints!,
    forceGc: options.forceGc!,
  };
}

function buildRequests(
  suite: BenchmarkSuite,
  options: ParsedOptions,
  parameters: PerformanceParameters | MemoryParameters,
  experimentId: string,
  gitMetadata: GitMetadata,
): WorkerRequest[] {
  return frameworkSchedule(selectedFrameworks(options.framework), options.replicates).map(
    ({ framework, replicate }) =>
      createWorkerRequest(
        experimentId,
        suite,
        framework,
        options.phase,
        replicate,
        parameters,
        gitMetadata,
      ),
  );
}

async function executeRequests(
  requests: WorkerRequest[],
  outputRoot: string,
  batch: BatchTracker,
): Promise<RunArtifact[]> {
  const artifacts: RunArtifact[] = [];
  for (const request of requests) {
    process.stdout.write(
      `Starting ${request.suite} ${request.framework} replicate ${request.replicate}...\n`,
    );
    try {
      const artifact = await runFreshProcess(request);
      const path = await writeRunArtifact(artifact, outputRoot);
      await verifyRunArtifactFile(path, artifact.manifest.runId);
      await batch.markCompleted(request.runId, path);
      process.stdout.write(`Passed ${artifact.manifest.runId}: ${path}\n`);
      artifacts.push(artifact);
    } catch (error) {
      await batch.markFailed(request.runId, error);
      throw error;
    }
  }
  return artifacts;
}

async function executeBatch(
  requests: WorkerRequest[],
  outputRoot: string,
  validate: (artifacts: RunArtifact[]) => void = () => undefined,
): Promise<RunArtifact[]> {
  const first = requests[0];
  if (!first) throw new Error('A batch must contain at least one planned run.');
  assertFinalGitState(first.phase, first.gitMetadata);
  const batch = await BatchTracker.create(
    outputRoot,
    first.experimentId,
    first.phase,
    requests.map(({ runId, suite, framework, replicate }) => ({
      runId,
      suite,
      framework,
      replicate,
    })),
  );
  process.stdout.write(`Batch ${first.experimentId}: ${batch.path}\n`);

  try {
    const artifacts = await executeRequests(requests, outputRoot, batch);
    validate(artifacts);
    await batch.markCompletedBatch();
    return artifacts;
  } catch (error) {
    await batch.markBatchFailed(error);
    throw error;
  }
}

function validatePilot(artifacts: RunArtifact[]): void {
  const performanceArtifacts = artifacts.filter(
    ({ manifest }) => manifest.suite === 'performance',
  );
  const observableResults = new Map(
    performanceArtifacts.map((artifact) => [
      artifact.manifest.framework,
      (artifact.records as PerformanceRecord[]).map(({ checksum, deliveredEvents }) => [
        checksum,
        deliveredEvents,
      ]),
    ]),
  );
  if (
    JSON.stringify(observableResults.get('nestjs')) !==
    JSON.stringify(observableResults.get('cordis'))
  ) {
    throw new Error('Pilot framework checksum/delivery comparison failed.');
  }
  if (
    !artifacts.every(
      ({ validation }) =>
        validation.checksumsVerified &&
        validation.registrationsVerified &&
        validation.resourcesReleased,
    )
  ) {
    throw new Error('Pilot lifecycle validation failed.');
  }
}

async function runPilot(): Promise<void> {
  const experimentId = createExperimentId('pilot');
  const gitMetadata = readGitMetadata();
  const common: ParsedOptions = {
    framework: 'both',
    phase: 'pilot',
    replicates: 1,
    outputRoot: defaultOutputRoot('pilot'),
    payloadSizeBytes: 4096,
    subscriptionCount: 4,
    eventCount: 32,
  };
  const performance: PerformanceParameters = {
    payloadSizeBytes: common.payloadSizeBytes,
    subscriptionCount: common.subscriptionCount,
    eventCount: common.eventCount,
    warmupCycles: 5,
    measuredCycles: 25,
  };
  const memory: MemoryParameters = {
    payloadSizeBytes: common.payloadSizeBytes,
    subscriptionCount: common.subscriptionCount,
    eventCount: common.eventCount,
    memoryWarmupCycles: 100,
    lifecycleCycles: 25,
    checkpoints: [0, 5, 10, 25],
    forceGc: true,
  };
  const requests = [
    ...buildRequests('performance', common, performance, experimentId, gitMetadata),
    ...buildRequests('memory', common, memory, experimentId, gitMetadata),
  ];
  await executeBatch(requests, common.outputRoot, validatePilot);
  process.stdout.write(`Pilot ${experimentId} passed for both frameworks and both suites.\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === '--help' || command === 'help' || process.argv.slice(3).includes('--help')) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (command === 'pilot') {
    await runPilot();
    return;
  }
  if (command !== 'performance' && command !== 'memory') {
    throw new Error('Use --help for benchmark runner usage.');
  }

  const options = parseCommon(process.argv.slice(3), command);
  const gitMetadata = readGitMetadata();
  assertFinalGitState(options.phase, gitMetadata);
  const experimentId = createExperimentId(options.phase);
  const parameters =
    command === 'performance' ? performanceParameters(options) : memoryParameters(options);
  const requests = buildRequests(
    command,
    options,
    parameters,
    experimentId,
    gitMetadata,
  );
  await executeBatch(requests, options.outputRoot);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
