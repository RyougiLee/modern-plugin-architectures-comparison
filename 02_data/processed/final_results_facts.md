# Final results fact sheet

## RQ1

- NestJS checkpoint-2000 heap used delta: median 1.472 MiB, IQR 0.018 MiB (`rq1_memory_summary.csv`).
- NestJS checkpoint-2000 rss delta: median 7.496 MiB, IQR 1.151 MiB (`rq1_memory_summary.csv`).
- NestJS checkpoint-2000 external delta: median -0.055 MiB, IQR 0.036 MiB (`rq1_memory_summary.csv`).
- NestJS checkpoint-2000 array buffers delta: median 0.046 MiB, IQR 0.220 MiB (`rq1_memory_summary.csv`).
- NestJS: 0 checkpoints with non-zero controlled resources and 0 run-level post-disposal resource failures (`rq1_resource_cleanup_summary.csv`).
- Cordis checkpoint-2000 heap used delta: median 0.153 MiB, IQR 0.000 MiB (`rq1_memory_summary.csv`).
- Cordis checkpoint-2000 rss delta: median 18.869 MiB, IQR 0.375 MiB (`rq1_memory_summary.csv`).
- Cordis checkpoint-2000 external delta: median 1.885 MiB, IQR 0.059 MiB (`rq1_memory_summary.csv`).
- Cordis checkpoint-2000 array buffers delta: median 1.453 MiB, IQR 0.003 MiB (`rq1_memory_summary.csv`).
- Cordis: 0 checkpoints with non-zero controlled resources and 0 run-level post-disposal resource failures (`rq1_resource_cleanup_summary.csv`).

## RQ2

- NestJS load: median of 20 process-replicate medians 34.450 µs, IQR 2.600 µs (`rq2_framework_summary.csv`).
- NestJS exercise: median of 20 process-replicate medians 1.000 µs, IQR 0.100 µs (`rq2_framework_summary.csv`).
- NestJS dispose: median of 20 process-replicate medians 0.500 µs, IQR 0.000 µs (`rq2_framework_summary.csv`).
- NestJS total: median of 20 process-replicate medians 36.050 µs, IQR 2.800 µs (`rq2_framework_summary.csv`).
- Cordis load: median of 20 process-replicate medians 289.150 µs, IQR 20.000 µs (`rq2_framework_summary.csv`).
- Cordis exercise: median of 20 process-replicate medians 1.100 µs, IQR 0.100 µs (`rq2_framework_summary.csv`).
- Cordis dispose: median of 20 process-replicate medians 82.450 µs, IQR 6.638 µs (`rq2_framework_summary.csv`).
- Cordis total: median of 20 process-replicate medians 375.350 µs, IQR 25.538 µs (`rq2_framework_summary.csv`).
- Paired total-latency ratio (Cordis/NestJS): median 10.552; median paired percentage difference 955.243% (`rq2_paired_comparison.csv`).

## RQ3

- NestJS: plugin lifecycle 26 SLOC, framework orchestration 48 SLOC, cleanup 22 SLOC, nominal/host/failure actions 3/2/0 (`rq3_final_metrics.csv`).
- Cordis: plugin lifecycle 15 SLOC, framework orchestration 53 SLOC, cleanup 17 SLOC, nominal/host/failure actions 2/2/1 (`rq3_final_metrics.csv`).

## Diagnostic supporting evidence

- The 10,000-cycle exploratory memory run and heap snapshots are excluded from every primary RQ1 and RQ2 table. This pipeline reads only the two allowlisted final experiment directories (`final_data_audit.json`).
- Diagnostic object-retention findings remain separate supporting evidence and are not pooled with final replicate statistics (`analysis_manifest.json`).

## Reliability / validity observations

- The validation gate passed for 40 performance runs and 20 memory runs (`final_data_audit.json`).
- All final runs used benchmark commit `5dab909c7ebcc08046e5aa23bac29815b605e48b` and package-lock SHA-256 `09df3eb847d97ae0852e56f8f0b31c20e0e977a55c4c95b65b0b03b0e87d8263` (`final_data_audit.json`).
- The 62 allowlisted JSON files have aggregate SHA-256 `307123daea13d1981afdab6793249025efcf968c8f50405b9520745e553ef64e` (`final_data_audit.json`).
- RQ2 framework summaries use one cycle median per fresh process replicate. The 2,000 cycles within a process are not treated as independent replicates (`rq2_replicate_summary.csv`).
- Memory growth and controlled-resource cleanup are reported separately; zero ledger counts do not classify process-memory behavior as leak-free (`rq1_resource_cleanup_summary.csv`, `rq1_memory_summary.csv`).
