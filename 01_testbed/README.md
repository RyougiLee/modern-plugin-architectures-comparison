# Cordis/NestJS Lifecycle Benchmark Testbed

This directory is the complete headless TypeScript/Node.js project for the
equivalent plugin-style load/use/dispose workload. The thesis repository root is
not an npm project, and no npm workspaces are used.

## Implemented comparison

- `shared`: deterministic payload, callbacks, event bus, resource ledger,
  lifecycle contracts, and invariant checks.
- `nestjs-app`: a NestJS-based lifecycle adapter. A persistent application
  context uses the documented `ModuleRef.create()` API to construct each plugin
  instance through dependency injection. Disposal is explicit and testbed-owned;
  this is not described as native NestJS hot-unload.
- `cordis-app`: a persistent Cordis root context loads a reusable plugin and
  retains its returned fork. External event-bus subscriptions are bound to the
  fork with `ctx.effect()` and released by `fork.dispose()`.
- `runner`: separate performance and memory workers, one fresh Node.js child
  process per replicate, immutable raw JSON output, batch manifests, Git guards,
  and run metadata.
- `rq3`: the reproducible source counter implementing the frozen RQ3 rule in
  `spec/rq3_counting_rule.md`.
- `tests`: deterministic-workload, adapter-equivalence, cleanup,
  process-isolation, checkpoint, and output-safety smoke tests.

Dependencies are exact versions in this directory's `package.json` and
`package-lock.json`.

## Reproduce the first testbed version

From the thesis repository root:

```powershell
Set-Location 01_testbed
npm ci --ignore-scripts
npm test
npm run pilot
```

The pilot uses deliberately short validation settings: one replicate per
framework, 5 warm-up plus 25 measured performance cycles, and 100 memory warm-up
cycles followed by 25 measured memory cycles with checkpoints at 0, 5, 10, and
25. It is not a final data-collection configuration.

Pilot raw files are written beneath `results/pilot/schema-v2/<experimentId>/`.
Each invocation has one experiment ID and batch manifest; each replicate also has
a unique run ID and is created with exclusive file semantics, so an existing run
can never be silently overwritten. Schema-v2 directories prevent new records
from being silently mixed with older pilot JSON.

Local development directories `node_modules/`, `dist/`, and `results/` are
excluded by the repository `.gitignore`. Existing pilot data is retained locally.
Final research data remains separate under `../02_data/raw`; schema-v1 pilot data
must not be included in schema-v2/final analysis.

## Protocol phases

Pilot artifacts validate the testbed, exploratory artifacts support parameter
selection and stability checks, and diagnostic artifacts support interpretation.
Only `final`-phase artifacts under `../02_data/raw` may be used for final
analysis. Do not mix schema-v1, pilot, exploratory, diagnostic, and final data.

The authoritative frozen configuration is
`../00_meta/experiment-lock.json` (`final-v1`). Exploratory commands remain
available for non-final checks:

```powershell
npm run -- benchmark:performance -- --framework both --phase exploratory
npm run -- benchmark:memory -- --framework both --phase exploratory
```

Common options are `--replicates`, `--payload-size`, `--subscriptions`,
`--events`, `--cycles`, and `--output`. Performance also accepts `--warmup`.
Memory accepts `--memory-warmup`, an ascending comma-separated `--checkpoints`
list, and `--force-gc true|false`. When changing memory cycle count, supply
checkpoints whose first value is 0 and last value equals the cycle count.

Example short exploratory run:

```powershell
npm run -- benchmark:performance -- --framework both --replicates 2 --warmup 10 --cycles 100
npm run -- benchmark:memory -- --framework both --replicates 2 --memory-warmup 100 --cycles 100 --checkpoints 0,25,50,100 --force-gc true
```

The validated longer exploratory and diagnostic configurations are:

```powershell
npm run -- benchmark:performance -- --framework both --phase exploratory --replicates 3 --warmup 1000 --cycles 2000
npm run -- benchmark:memory -- --framework both --phase exploratory --replicates 2 --memory-warmup 100 --cycles 10000 --checkpoints 0,500,1000,2000,4000,6000,8000,10000 --force-gc true
```

The 10,000-cycle memory run is supporting diagnostic evidence, not the primary
final RQ1 experiment. Heap snapshots likewise remain outside normal benchmark
collection.

## Frozen final collection

The frozen final workload is a nominal 4,096-byte payload with 4 subscriptions
and 32 events. Performance uses 1,000 warm-up cycles, 2,000 measured cycles, and
20 replicates per framework. Memory uses 100 warm-up cycles, 2,000 lifecycle
cycles, 10 replicates per framework, checkpoints at 0, 100, 250, 500, 1000,
1500, and 2000, and forced GC at checkpoints.

From `01_testbed`, the exact PowerShell-compatible commands are:

```powershell
npm run -- benchmark:performance -- --framework both --phase final --replicates 20 --warmup 1000 --cycles 2000 --payload-size 4096 --subscriptions 4 --events 32
npm run -- benchmark:memory -- --framework both --phase final --replicates 10 --memory-warmup 100 --cycles 2000 --checkpoints "0,100,250,500,1000,1500,2000" --force-gc true --payload-size 4096 --subscriptions 4 --events 32
```

Final output defaults to `../02_data/raw`. Final collection is rejected before
any child starts unless the project has a determinable Git commit and a clean
working tree. Use `node dist/runner/cli.js --help` for the full option list.

The runner stops on the first failed replicate. Its batch manifest preserves a
portable failure summary (exit code, error name, concise message, framework,
suite, and replicate) and leaves unattempted planned runs marked incomplete.
Detailed worker stacks remain available on the console but are not persisted in
research artifacts.

## Measurement boundaries

Performance records use `process.hrtime.bigint()` and store nanoseconds as
decimal strings. Load, exercise, and dispose are timed separately. Registration
validation follows load timing, checksum/delivery validation follows exercise
timing, and resource-release validation follows dispose timing. The
`measuredTotalNanoseconds` field is exactly the sum of the three operation
durations; validation, file output, console logging, JSON serialization, and
forced GC are excluded.

Measured values are retained during the loop in fixed-size typed arrays for
load, exercise, dispose, checksum, and delivery count. Per-cycle JSON objects
and their deterministic owner IDs are reconstructed only after every measured
cycle is complete. Each performance artifact also contains diagnostic-only
`stabilityDiagnostics`: up to 10 contiguous, near-equal blocks with median
total and component timings. These summaries do not produce a pass/fail claim.

Memory warm-up lifecycles are validated before checkpoint 0 and excluded from
measurement records. Memory records are taken only at configured checkpoints
after a complete disposal and resource check. When requested, forced GC occurs
immediately before the checkpoint snapshot and is recorded in both the manifest
and each record.

Each memory artifact includes `memoryDiagnostics` with heap-used, RSS, external,
and array-buffer deltas from checkpoint 0. Raw checkpoint values remain
unchanged, and the runner does not classify the trend as a leak or non-leak.

## Diagnostic-only heap snapshots

Heap retention investigation is deliberately separate from both benchmark
suites and writes only beneath `results/diagnostic/heap/`. It uses the nominal
4096-byte, four-subscription, 32-event workload, 100 warm-up lifecycles, forced
GC, a baseline snapshot, 10,000 additional lifecycles, forced GC, and a final
snapshot. Run each framework independently:

```powershell
npm run diagnostic:heap -- --framework nestjs
npm run diagnostic:heap -- --framework cordis
```

The diagnostic manifest stores portable relative snapshot paths and normal Git,
lockfile, runtime, parameter, and invariant metadata. The adjacent comparison
JSON reports constructor/category count and shallow-size deltas. Heap snapshot
size and capture time are not benchmark metrics, and the tool does not classify
the result as a leak or non-leak.

Every raw artifact includes the run ID, framework, nominal scenario, suite,
replicate, Node/package versions, package-lock SHA-256, OS and architecture, CPU
information, benchmark parameters, Git state, registration/cleanup validation,
and raw timing or memory records.

## RQ3 reproducible code count

The frozen `rq3-sloc-v2` rule reports plugin lifecycle SLOC,
framework-specific lifecycle orchestration SLOC, cleanup SLOC, and three separate
cleanup-action categories: nominal plugin cleanup, host shutdown, and failure
recovery. RQ3 primarily uses the nominal category; the other two are supporting
metrics. The rule counts only marked regions in the two adapter source files:

```powershell
npm run rq3:count
```

Batch manifests store artifact locations relative to their experiment directory,
for example `performance/nestjs/<run-id>.json`. Run manifests record the Git
commit and dirty state but never persist the machine-specific repository root.
