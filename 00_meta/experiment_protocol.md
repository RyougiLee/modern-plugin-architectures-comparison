# Experiment Protocol

Status: **FINAL — FROZEN**

Protocol version: `final-v1`

The authoritative machine-readable configuration is
`00_meta/experiment-lock.json`. After final data collection begins, any protocol
change requires a new protocol and experiment version.

## 1. Primary Comparison

Primary scenarios:

- `nestjs_nominal`
- `cordis_nominal`

Both must implement correct lifecycle behavior.

Optional fault/boundary scenarios may be added later but must not be merged with the primary results.

## 2. Common Workload

Each lifecycle cycle must perform the same logical work:

1. load one plugin instance;
2. allocate the configured plugin payload;
3. register the configured number of event subscriptions;
4. execute the configured number of deterministic event deliveries;
5. verify the expected result/checksum;
6. dispose the plugin;
7. verify plugin-owned resources return to the expected baseline.

## 3. Pilot, Exploratory, Diagnostic, and Final Phases

The pilot validated execution, invariants, process isolation, and raw output.
Exploratory runs evaluated timing stability and memory trends. Diagnostic runs,
including the 10,000-cycle memory investigation and heap snapshots, provide
supporting evidence only and are not primary RQ1 data.

The final phase uses only the frozen parameters below. Final analysis must use
only `final`-phase artifacts under `02_data/raw`; schema-v1, pilot, exploratory,
and diagnostic artifacts must not be mixed with the final dataset.

## 4. Performance Suite

Purpose: RQ2.

Frozen final parameters:

- frameworks: NestJS and Cordis;
- workload: nominal, 4,096-byte payload, 4 subscriptions, 32 events;
- warm-up: 1,000 cycles;
- measured cycles: 2,000 per replicate;
- replicates: 20 per framework;
- forced GC: disabled;
- fresh Node.js process per independent replicate;
- alternating framework order.

Rules:

- fresh child process per replicate;
- warm-up before timing;
- use a monotonic high-resolution timer;
- do not force GC inside timed regions;
- do not write files inside timed regions;
- keep logging outside measured regions;
- record load, exercise, dispose, and measured-total latency;
- calculate measured total as load + exercise + dispose only;
- keep invariant validation outside all timed regions.

## 5. Memory Suite

Purpose: RQ1.

Frozen final parameters:

- frameworks: NestJS and Cordis;
- workload: nominal, 4,096-byte payload, 4 subscriptions, 32 events;
- warm-up: 100 lifecycle cycles before checkpoint 0;
- measured lifecycle cycles: 2,000 per replicate;
- replicates: 10 per framework;
- checkpoints: 0, 100, 250, 500, 1000, 1500, 2000;
- forced GC: enabled at checkpoints;
- fresh Node.js process per independent replicate;
- alternating framework order.

Rules:

- fresh child process per replicate;
- same lifecycle workload;
- complete and validate memory warm-up cycles before checkpoint 0;
- exclude warm-up cycles from measured checkpoint numbering;
- fixed measurement checkpoints;
- disposal completes before checkpoint measurement;
- if forced GC is used, use the same procedure for both frameworks;
- record `process.memoryUsage()`;
- record explicit resource-ledger counts.

Required memory fields:

- `rss`;
- `heapTotal`;
- `heapUsed`;
- `external`;
- `arrayBuffers`.

## 6. Code Comparison

Purpose: RQ3.

The `rq3-sloc-v2` counting rule, its markers, and its metric definitions are
frozen for final collection.

Count only code directly required to implement the equivalent plugin lifecycle.

Report:

- lifecycle SLOC;
- cleanup SLOC;
- nominal per-plugin cleanup actions;
- host-shutdown cleanup actions as a separate supporting metric;
- failure-recovery cleanup actions as a separate supporting metric.

Do not combine host shutdown or failure recovery with the nominal plugin cleanup
action count used for the primary RQ3 comparison.

Exclude:

- comments;
- blank lines;
- imports;
- benchmark-runner code;
- tests;
- generated code;
- framework package source.

## 7. Run Order

Avoid always running all NestJS replicates first and all Cordis replicates second.

Use either:

- alternating framework order; or
- a deterministic shuffle with a recorded seed.

## 8. Invalid Runs

A run may be excluded only for a documented technical reason, such as:

- process crash;
- incomplete iteration count;
- checksum failure;
- schema/output failure;
- configuration mismatch.

Do not remove a valid run only because its value appears unusually slow or large.

## 9. Final Freeze

The final protocol is frozen with:

- Node.js 24.18.0;
- `@nestjs/common` 11.2.5;
- `@nestjs/core` 11.2.5;
- Cordis 3.18.1;
- TypeScript 5.9.3;
- `reflect-metadata` 0.2.2;
- RxJS 7.8.2;
- the workload and suite parameters in `00_meta/experiment-lock.json`.

Each final run manifest records the actual Git commit, dirty state, and
package-lock SHA-256. The protocol lock deliberately does not contain a
self-referential source commit.
