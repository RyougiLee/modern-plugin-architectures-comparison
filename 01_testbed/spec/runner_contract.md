# Benchmark Runner Contract

## Process Isolation

Every independent replicate must run in a fresh Node.js process.

The parent runner may orchestrate many replicates.

## Suites

Implement two separate suites.

### Performance suite

- warm-up;
- measured cycles;
- no forced GC inside timing;
- collect load/exercise/dispose latency;
- derive measured total only from those three timed operations;
- validate registration, results, and cleanup outside timed regions;
- write buffered results after timing.

### Memory suite

- fixed lifecycle checkpoints;
- configurable validated lifecycle warm-up before checkpoint 0;
- disposal before checkpoint measurement;
- optional forced GC according to protocol;
- `process.memoryUsage()` snapshot;
- resource-ledger snapshot.

## Run Metadata

Every replicate records:

- shared experiment ID;
- unique run ID;
- suite;
- framework;
- scenario;
- replicate number;
- Node.js version;
- framework/package versions;
- OS/architecture;
- benchmark parameters;
- Git commit when available.
- working-tree dirty state when available;
- SHA-256 of `package-lock.json`.

The local Git repository root may be used internally for validation but must not
be serialized into run or batch research artifacts.

Final runs require a usable Git commit and a clean working tree. The runner must
reject the entire final invocation before starting children when this guard fails.

## Output Safety

- never overwrite an existing run ID;
- raw files are append-only/immutable after creation;
- pilot and final runs should be distinguishable.
- schema versions should be separated rather than silently mixed.

## Batch Manifest

One parent invocation uses one experiment ID and one batch manifest. The manifest
records every planned framework/suite/replicate, completed and failed counts, and
failure reasons. The runner stops deterministically on the first failed run and
leaves later planned runs marked incomplete.

Artifact paths stored in the batch manifest are relative to the experiment
directory and use `/` separators. Machine-specific absolute paths are forbidden
inside research artifacts.

Pilot and exploratory output defaults beneath `01_testbed/results`. Final output
defaults beneath `02_data/raw` at the thesis repository root.

## Logging

Keep console logging minimal during measurement.

Verbose output may be used in smoke/pilot mode only.

## Pilot Command

Provide one simple command that runs a short pilot for both frameworks and reports whether all invariants passed.
