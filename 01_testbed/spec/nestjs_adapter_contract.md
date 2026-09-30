# NestJS Adapter Contract

## Purpose

Implement a plugin-style lifecycle on top of NestJS dependency injection without claiming that NestJS provides native Cordis-equivalent runtime plugin disposal.

## Requirements

- use NestJS DI for plugin dependency construction/resolution;
- keep the host container alive across cycles where practical;
- define explicit plugin `load` and `dispose` boundaries in a testbed-owned adapter;
- track plugin-owned subscriptions/resources;
- release all controlled plugin-owned resources in nominal disposal.

## Conceptual Flow

```text
NestJS host container
-> adapter creates/resolves plugin instance
-> plugin registers controlled resources
-> shared workload runs
-> adapter performs explicit disposal
-> resource ledger verifies zero plugin-owned resources
```

## Terminology

Use:

- `NestJS-based lifecycle baseline`;
- `NestJS lifecycle adapter`;
- `explicit disposal`.

Avoid:

- `native NestJS hot-unload`;
- treating `DynamicModule` as a hot-unload mechanism.

## Implementation Choice

Use an appropriate documented NestJS API for dynamic creation/resolution.

If the chosen NestJS version makes the planned lifecycle awkward or changes relevant APIs, stop and document the issue before inventing unsupported behavior.
