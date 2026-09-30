# Research Questions

## RQ1 — Resource Cleanup

**How do Cordis and the NestJS-based baseline differ in resource cleanup behavior during repeated plugin-style load/use/dispose cycles under an equivalent workload?**

Primary evidence:

- post-disposal resource-ledger counts;
- post-GC `heapUsed` at fixed checkpoints;
- RSS as supporting process-level information.

Important interpretation rule:

A rising heap value alone is not sufficient to claim a memory leak. A leak claim should be supported by retained controlled resources or another clearly identified mechanism.

## RQ2 — Lifecycle Performance

**How do Cordis and the NestJS-based baseline differ in lifecycle-operation latency under the same workload and runtime environment?**

Primary metrics:

- load latency;
- dispose latency;
- total lifecycle-cycle latency.

The result describes the implemented testbed path only. It must not be generalized to all workloads or all framework use cases.

## RQ3 — Explicit Lifecycle-Management Code

**How do Cordis and the NestJS-based baseline differ in the amount of explicit lifecycle-management code required to implement the same workload?**

Primary metrics:

- lifecycle-related source lines of code;
- cleanup-specific source lines of code;
- number of explicit cleanup actions/registrations.

RQ3 does not measure general Developer Experience, cognitive load, usability, or developer satisfaction.
