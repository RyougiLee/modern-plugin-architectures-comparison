# Final benchmark analysis

This directory contains the reproducible descriptive-analysis pipeline for the
two frozen final experiments. Python 3.12 or newer is required.

## Inputs

Only these directories are accepted:

- Performance: `02_data/raw/final/schema-v2/final-20260920172537463-8e9f6c97`
- Memory: `02_data/raw/final/schema-v2/final-20260920172714537-a5a8831b`

The scripts open raw JSON read-only. They never scan other raw, pilot,
exploratory, or diagnostic directories. Generated tables and reports go to
`02_data/processed`; figures go to `02_data/figures`.

## Environment

From the repository root in PowerShell:

```powershell
python -m venv .analysis-venv
.\.analysis-venv\Scripts\python.exe -m pip install -r 03_analysis\requirements.txt
```

The virtual environment is local tooling and should not be committed.

## Commands

Run the validation gate independently:

```powershell
.\.analysis-venv\Scripts\python.exe 03_analysis\validate_final.py
```

Run the complete analysis. This reruns validation before writing statistical
tables or figures:

```powershell
.\.analysis-venv\Scripts\python.exe 03_analysis\analyze_final.py
```

With an already configured Python environment, the shorter equivalents are:

```powershell
python 03_analysis\validate_final.py
python 03_analysis\analyze_final.py
```

At analysis startup, before validation reports, CSVs, or figures are written,
the script records the analysis-source Git commit and whether the working tree
is dirty. For an unambiguous final manifest, commit analysis-source changes and
start the analysis from a clean working tree.

Before running the frozen RQ3 counter, the analysis compares both counted
adapter files, the counting script, and the `rq3-sloc-v2` specification against
benchmark commit `5dab909c7ebcc08046e5aa23bac29815b605e48b`. It aborts RQ3
generation if any guarded source differs. The regenerated metrics are also
checked against the audited `rq3-sloc-v2` values.

## Statistical scope

The independent RQ2 unit is one fresh Node.js process replicate. Each run's
2,000 lifecycle cycles are repeated observations used to calculate that
process's descriptive summary. They are not treated as 2,000 independent
replicates. Framework-level RQ2 summaries therefore use 20 process-level cycle
medians per framework.

For RQ1, checkpoint deltas are calculated from checkpoint 0 separately inside
each process. Each checkpoint summary then uses the 10 independent process
replicates per framework. Controlled-resource cleanup and process-memory deltas
remain distinct evidence. Memory growth is not automatically classified as a
resource leak.

Primary evidence consists only of the final 10 × 2,000-cycle memory runs per
framework and final 20-replicate performance runs per framework. The previous
10,000-cycle exploratory memory run, heap snapshots, and retention-path
investigation remain supporting diagnostic evidence and are excluded from all
primary statistics.

No inferential tests are performed.

## Outputs

Validation:

- `final_data_audit.json`
- `final_data_audit.txt`

RQ2:

- `rq2_replicate_summary.csv`
- `rq2_framework_summary.csv`
- `rq2_paired_comparison.csv`
- `rq2_stability_summary.csv`
- `rq2_total_latency.pdf` and `.png`
- `rq2_operation_latency.pdf` and `.png`

RQ1:

- `rq1_checkpoint_deltas.csv`
- `rq1_memory_summary.csv`
- `rq1_resource_cleanup_summary.csv`
- `rq1_cycle2000_memory_comparison.csv`
- `rq1_heap_used_delta.pdf` and `.png`

RQ3 and reproducibility:

- `rq3_final_metrics.json`
- `rq3_final_metrics.csv`
- `final_results_facts.md`
- `analysis_manifest.json`
