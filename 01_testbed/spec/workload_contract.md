# Equivalent Workload Contract

## Goal

Cordis and NestJS must execute the same observable plugin workload.

## Plugin-Owned State

Each plugin instance owns:

- a deterministic payload of configured size;
- a configured number of event subscriptions;
- a deterministic accumulator/checksum;
- controlled resources registered in the resource ledger.

## Lifecycle

One lifecycle cycle is:

```text
load
-> register resources
-> exercise workload
-> verify checksum
-> dispose
-> verify resources
```

## Required Logical Work

For each cycle:

- create one plugin instance;
- allocate the same payload size;
- register the same number of callbacks;
- deliver the same number of events;
- execute the same callback computation;
- obtain the same expected checksum.

## Deterministic Callback

Use simple, deterministic CPU work.

Example behavior:

- read one or more payload values;
- combine them with event sequence/plugin ID;
- update an accumulator.

Avoid randomness unless it comes from a fixed recorded seed.

## Resource Invariants

Nominal scenario:

```text
before load:
  plugin-owned resources = 0

after registration:
  plugin-owned resources = configured expected count

after dispose:
  plugin-owned resources = 0
```

## Forbidden Differences

One framework implementation must not:

- use fewer events;
- allocate a smaller payload;
- skip callback work;
- skip disposal work that belongs to the nominal implementation;
- perform extra logging inside measured sections;
- use a materially different logical lifecycle.

If equivalent behavior cannot be maintained, stop and ask before proceeding.
