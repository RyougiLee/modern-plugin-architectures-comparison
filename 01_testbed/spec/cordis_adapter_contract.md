# Cordis Adapter Contract

## Purpose

Implement the Cordis side using documented context/plugin lifecycle mechanisms.

## Requirements

- create a Cordis root context;
- load the benchmark plugin through the documented plugin API;
- keep the returned plugin/fork scope as the lifecycle handle;
- use Cordis-managed effect APIs where appropriate;
- dispose the plugin/fork through the documented lifecycle API;
- explicitly connect any unmanaged external effect to disposal if the workload includes one.

## Conceptual Flow

```text
Cordis root context
-> load plugin / obtain lifecycle scope
-> register controlled resources
-> shared workload runs
-> dispose plugin/fork scope
-> resource ledger verifies zero plugin-owned resources
```

## Important Boundary

Do not assume:

> Cordis automatically cleans every possible side effect.

The implementation must distinguish between:

- framework-managed disposable effects;
- external effects that still require explicit lifecycle integration.

## Nominal Scenario

The nominal Cordis implementation must be correct and complete.

Any intentionally unmanaged-effect scenario must be implemented later as a separate diagnostic case.
