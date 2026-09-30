# Instrumentation Contract

## Timing

Use a monotonic high-resolution Node.js timing API.

Store durations in nanoseconds where practical.

Measure the same lifecycle boundaries in both implementations.

At minimum:

- load duration;
- exercise duration;
- dispose duration;
- measured total duration, calculated as load + exercise + dispose.

Resource-registration validation must occur after the load timer stops. Checksum
and delivery validation must occur after the exercise timer stops. Resource-release
validation must occur after the dispose timer stops. Validation work is not part
of any timing metric.

## Memory

Use public Node.js APIs.

Record:

- RSS;
- heap total;
- heap used;
- external memory;
- array buffer memory.

If `--expose-gc` is enabled:

- call forced GC only in the memory suite;
- call it only at defined checkpoints;
- record its use.

Perform and validate the configured memory warm-up cycles before forced GC and
checkpoint 0. Warm-up cycles are not memory measurement records and do not count
toward measured lifecycle checkpoint numbers.

## Resource Ledger

Implement a simple explicit ledger for controlled plugin-owned resources.

At minimum track:

- active subscriptions;
- total active controlled resources;
- owner plugin ID.

The ledger must support assertions after disposal.

## Correctness Check

Each cycle must produce a deterministic expected result/checksum.

If the checksum is wrong, the run is invalid.

## Measurement Hygiene

Do not perform inside timed regions:

- synchronous file writes;
- large JSON serialization;
- console logging;
- heap snapshots;
- forced GC.

Heap snapshots may be added later as diagnostic evidence, but they are not required for the first testbed version.
