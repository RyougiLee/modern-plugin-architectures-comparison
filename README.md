# Evaluating Spatio-Temporal Composability in Modern Plugin Architectures

This repository is the **public research artefact** associated with the Bachelor of Engineering thesis:

> **Evaluating Spatio-Temporal Composability in Modern Plugin Architectures: A Comparative Study of Cordis and NestJS**

The thesis compares two plugin-style lifecycle approaches under the same deterministic workload:

- **Cordis 3.18.1**, using a persistent root context, disposable plugin forks, and context-bound cleanup.
- A **NestJS-based lifecycle adapter** using NestJS dependency injection and `ModuleRef.create()`, with explicit plugin-level disposal.

This repository contains only the files required to inspect and reproduce the experimental work. The complete thesis-development repository remains private.

> **Scope note:** the NestJS side is a testbed-defined lifecycle adapter built on NestJS dynamic instantiation. It is not presented as a native NestJS hot-unload mechanism.

---

## Repository Purpose

This public repository is a curated reproducibility package containing:

- the benchmark testbed;
- the frozen experiment protocol;
- final raw benchmark artefacts;
- processed analysis outputs;
- final figures;
- RQ3 counting logic;
- validation and analysis scripts.

Files not required for reproduction, such as thesis drafts, literature notes, school documents, private development history, and temporary experiment artefacts, are intentionally excluded.

---

## Research Questions

The thesis addresses three questions.

### RQ1 — Resource Cleanup

How do Cordis and the NestJS-based lifecycle adapter differ in resource cleanup behaviour during repeated plugin-style load, exercise, and dispose cycles under an equivalent workload?

Primary evidence:

- benchmark-controlled resource-ledger state;
- post-GC process-memory measurements at fixed checkpoints.

A zero resource-ledger count means that the benchmark-controlled subscriptions were released. It does **not** prove that no framework-internal or otherwise uninstrumented objects remain reachable.

### RQ2 — Lifecycle Performance

How do Cordis and the NestJS-based lifecycle adapter differ in lifecycle-operation latency under the same workload and runtime environment?

Measured operations:

- load;
- exercise;
- dispose;
- measured total = load + exercise + dispose.

Validation, logging, file I/O, JSON serialisation, and garbage collection are outside the timed regions.

### RQ3 — Explicit Lifecycle-Management Code

How do Cordis and the NestJS-based lifecycle adapter differ in the amount of explicit lifecycle-management code required to implement the same workload?

The frozen `rq3-sloc-v2` rule reports:

- plugin lifecycle SLOC;
- framework-specific lifecycle orchestration SLOC;
- cleanup SLOC;
- nominal plugin cleanup actions;
- host-shutdown cleanup actions;
- failure-recovery cleanup actions.

These metrics describe explicit lifecycle-management code only. They are not direct measures of maintainability, developer experience, cognitive load, or overall software modularity.

---

## Public Repository Structure

A typical structure of this curated repository is:

```text
.
├── 00_meta/
│   ├── experiment-lock.json
│   ├── experiment_protocol.md
│   └── research_questions.md
│
├── 01_testbed/
│   ├── cordis-app/
│   ├── nestjs-app/
│   ├── rq3/
│   ├── runner/
│   ├── shared/
│   ├── spec/
│   ├── tests/
│   ├── package.json
│   ├── package-lock.json
│   └── tsconfig.json
│
├── 02_data/
│   ├── raw/
│   │   └── final/
│   │       └── schema-v2/
│   ├── processed/
│   └── figures/
│
├── 03_analysis/
│   ├── analyze_final.py
│   ├── validate_final.py
│   ├── requirements.txt
│   └── README.md
│
├── .gitignore
└── README.md
```

The repository root is **not** an npm workspace. Node.js commands should be run from `01_testbed/`.

---

## Original Benchmark Provenance

The thesis project was originally developed in a **private Git repository**.

The final benchmark data reported in the thesis were generated from the following frozen source revision in that private repository:

```text
Original benchmark Git commit:
5dab909c7ebcc08046e5aa23bac29815b605e48b

Original benchmark tag:
thesis-benchmark-final-v1
```

The dependency lock used for final collection has SHA-256:

```text
09df3eb847d97ae0852e56f8f0b31c20e0e977a55c4c95b65b0b03b0e87d8263
```

Final experiment IDs:

```text
Performance:
final-20260920172537463-8e9f6c97

Memory:
final-20260920172714537-a5a8831b
```

### Important provenance note

This public repository has its **own Git history** because it was created as a curated research artefact after the thesis experiments had been completed.

Therefore:

- the public repository's current commit SHA is **not** the same as the original private benchmark commit;
- `5dab909c7ebcc08046e5aa23bac29815b605e48b` identifies the exact source revision used to generate the thesis benchmark data in the original private repository;
- the files published here are the curated source and data artefacts required to inspect and reproduce that experiment.

Do not assume that `git checkout 5dab909...` will work in this public repository.

---

## Frozen Final Workload

Both framework paths used the same deterministic workload.

| Parameter | Value |
|---|---:|
| Payload size | 4,096 bytes |
| Event subscriptions per plugin | 4 |
| Events per lifecycle cycle | 32 |
| Expected callback deliveries | 128 |

The lifecycle sequence was:

```text
load
→ validate registration
→ exercise
→ validate result
→ dispose
→ validate release
```

A cycle was rejected if registration, checksum, callback-count, or post-disposal resource validation failed.

---

## Final Performance Configuration

Per framework:

| Parameter | Value |
|---|---:|
| Warm-up cycles | 1,000 |
| Measured lifecycle cycles | 2,000 |
| Replicates | 20 |
| Independent replicate | Fresh Node.js process |
| Framework order | Alternating by replicate |
| Forced GC | Disabled |

The framework host remained active within each replicate while plugin instances were repeatedly loaded and disposed.

---

## Final Memory Configuration

Per framework:

| Parameter | Value |
|---|---:|
| Warm-up cycles | 100 |
| Lifecycle cycles | 2,000 |
| Replicates | 10 |
| Checkpoints | 0, 100, 250, 500, 1000, 1500, 2000 |
| Independent replicate | Fresh Node.js process |
| Framework order | Alternating by replicate |
| Forced GC | At memory checkpoints |

Checkpoint 0 was recorded after warm-up and forced garbage collection and was used as the within-process baseline.

Recorded process-memory fields include:

- `heapUsed`;
- `heapTotal`;
- `rss`;
- `external`;
- `arrayBuffers`.

---

## Software Versions Used for Final Collection

| Software | Version |
|---|---:|
| Node.js | 24.18.0 |
| TypeScript | 5.9.3 |
| `@nestjs/common` | 11.2.5 |
| `@nestjs/core` | 11.2.5 |
| Cordis | 3.18.1 |
| `reflect-metadata` | 0.2.2 |
| RxJS | 7.8.2 |

The original final measurements were collected on:

- Windows x64;
- OS release `10.0.26200`;
- 12th Gen Intel Core i7-12700H;
- 20 logical CPUs.

---

## Testbed Setup

For the closest reproduction of the thesis environment, use **Node.js 24.18.0**.

From the repository root:

```powershell
Set-Location 01_testbed
npm ci --ignore-scripts
npm test
```

The test suite verifies benchmark behaviour, adapter equivalence, lifecycle cleanup, process isolation, checkpoint validation, and output safety.

For additional runner and testbed details, see:

```text
01_testbed/README.md
```

if that file is included in the public snapshot.

---

## Re-running the Final Benchmark

Final-mode runs require:

- a determinable Git commit;
- a clean Git working tree;
- the frozen workload parameters;
- independent fresh Node.js processes for replicates.

From `01_testbed/`, the final performance configuration is:

```powershell
npm run -- benchmark:performance -- `
  --framework both `
  --phase final `
  --replicates 20 `
  --warmup 1000 `
  --cycles 2000 `
  --payload-size 4096 `
  --subscriptions 4 `
  --events 32
```

The final memory configuration is:

```powershell
npm run -- benchmark:memory -- `
  --framework both `
  --phase final `
  --replicates 10 `
  --memory-warmup 100 `
  --cycles 2000 `
  --checkpoints "0,100,250,500,1000,1500,2000" `
  --force-gc true `
  --payload-size 4096 `
  --subscriptions 4 `
  --events 32
```

New final-mode runs will generate new experiment and run IDs. They should therefore be treated as independent reproductions rather than replacements for the frozen thesis data.

---

## Final Data

The frozen final raw benchmark artefacts are stored under:

```text
02_data/raw/final/schema-v2/
```

Only the two final experiments listed in the provenance section are used for the thesis statistics.

Pilot, exploratory, diagnostic, and older-schema data are excluded from the primary analysis.

Processed outputs are stored under:

```text
02_data/processed/
```

Typical final analysis files include:

```text
final_data_audit.json
final_data_audit.txt
analysis_manifest.json
final_results_facts.md

rq1_checkpoint_deltas.csv
rq1_memory_summary.csv
rq1_resource_cleanup_summary.csv
rq1_cycle2000_memory_comparison.csv

rq2_replicate_summary.csv
rq2_framework_summary.csv
rq2_paired_comparison.csv
rq2_stability_summary.csv

rq3_final_metrics.json
rq3_final_metrics.csv
```

Final figures are stored under:

```text
02_data/figures/
```

---

## Reproducing the Analysis

Python 3.12 or newer is recommended.

From the repository root:

```powershell
python -m venv .analysis-venv
.\.analysis-venv\Scripts\python.exe -m pip install -r 03_analysis\requirements.txt
```

Run the validation gate:

```powershell
.\.analysis-venv\Scripts\python.exe 03_analysis\validate_final.py
```

Run the final analysis:

```powershell
.\.analysis-venv\Scripts\python.exe 03_analysis\analyze_final.py
```

If a Python environment is already configured:

```powershell
python 03_analysis\validate_final.py
python 03_analysis\analyze_final.py
```

The final analysis:

- reads only the frozen final experiment directories;
- treats one fresh Node.js process as the independent replicate;
- uses 20 process-level replicate medians per framework for RQ2;
- uses 10 process replicates per framework and checkpoint for RQ1;
- performs descriptive analysis rather than inferential population-level testing;
- keeps controlled-resource cleanup separate from process-memory behaviour.

---

## RQ3 Code Counting

The frozen counting rule is:

```text
rq3-sloc-v2
```

Run from `01_testbed/`:

```powershell
npm run rq3:count
```

Final audited values:

| Metric | NestJS | Cordis |
|---|---:|---:|
| Plugin lifecycle SLOC | 26 | 15 |
| Framework-specific lifecycle orchestration SLOC | 48 | 53 |
| Cleanup SLOC | 22 | 17 |
| Nominal plugin cleanup actions | 3 | 2 |
| Host-shutdown cleanup actions | 2 | 2 |
| Failure-recovery cleanup actions | 0 | 1 |

The count applies only to the frozen marked source regions defined by the research protocol.

---

## Diagnostic Evidence

Heap-snapshot diagnostics were used only as **supporting evidence** during the thesis.

They are deliberately separate from the final benchmark statistics.

The diagnostic investigation observed that plugin-related objects remained reachable in the tested NestJS dynamic-instantiation path after repeated lifecycle cycles, while the corresponding Cordis plugin-instance count did not show the same accumulation.

This diagnostic evidence does **not** establish a universal NestJS memory leak and does not replace the primary RQ1 measurements.

If diagnostic artefacts are not included in this public snapshot, the thesis conclusions remain reproducible from the final benchmark data.

---

## Summary of Findings

Under the frozen workload:

- both implementations released the benchmark-controlled event subscriptions correctly;
- the NestJS-based lifecycle path showed continued post-GC `heapUsed` growth across the measured lifecycle cycles;
- the Cordis path reached a small post-GC `heapUsed` plateau;
- other process-memory fields did not all favour the same framework;
- the NestJS-based adapter showed substantially lower lifecycle-operation latency;
- Cordis required fewer plugin-lifecycle and cleanup lines, while its framework-orchestration region was slightly larger.

These findings apply to the tested lifecycle implementations and workload only. They should not be interpreted as a universal ranking of NestJS and Cordis.

---

## Reproducibility Model

The project uses the following provenance chain:

```text
Result
↓
raw JSON artefact
↓
run / batch manifest
↓
original benchmark Git revision
↓
exact benchmark source
↓
package-lock.json
```

The public repository preserves the artefacts needed to inspect this chain even though its Git history is separate from the original private development repository.

---

## Author

**Zongru Li**  
Bachelor of Engineering, Information Technology  
Metropolia University of Applied Sciences
