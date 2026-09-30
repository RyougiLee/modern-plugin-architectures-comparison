#!/usr/bin/env python3
"""Generate descriptive final-analysis tables, figures, and fact sheets."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from validate_final import (
    EXPECTED_GIT_COMMIT,
    EXPECTED_PACKAGE_LOCK_SHA256,
    MEMORY_EXPERIMENT_ID,
    MEMORY_ROOT,
    PERFORMANCE_EXPERIMENT_ID,
    PERFORMANCE_ROOT,
    PROCESSED_ROOT,
    REPOSITORY_ROOT,
    FinalDataValidationError,
    validate_final,
)


ANALYSIS_VERSION = "1.1.0"
BENCHMARK_TAG = "thesis-benchmark-final-v1"
JITTER_SEED = 20260920
FIGURES_ROOT = REPOSITORY_ROOT / "02_data" / "figures"
FRAMEWORK_ORDER = ["nestjs", "cordis"]
FRAMEWORK_LABELS = {"nestjs": "NestJS", "cordis": "Cordis"}
FRAMEWORK_COLORS = {"nestjs": "#35618D", "cordis": "#D47A2B"}
OPERATIONS = {
    "load": "loadNanoseconds",
    "exercise": "exerciseNanoseconds",
    "dispose": "disposeNanoseconds",
    "total": "measuredTotalNanoseconds",
}
MEMORY_METRICS = {
    "heap_used_delta": "heap_used_delta_bytes",
    "rss_delta": "rss_delta_bytes",
    "external_delta": "external_delta_bytes",
    "array_buffers_delta": "array_buffers_delta_bytes",
}
RQ3_GUARDED_PATHS = [
    "01_testbed/nestjs-app/nestjs-adapter.ts",
    "01_testbed/cordis-app/cordis-adapter.ts",
    "01_testbed/rq3/count.ts",
    "01_testbed/spec/rq3_counting_rule.md",
]
EXPECTED_RQ3_METRICS = {
    "nestjs": {
        "pluginLifecycleSloc": 26,
        "frameworkSpecificLifecycleOrchestrationSloc": 48,
        "cleanupSloc": 22,
        "nominalPluginCleanupActions": 3,
        "hostShutdownCleanupActions": 2,
        "failureRecoveryCleanupActions": 0,
    },
    "cordis": {
        "pluginLifecycleSloc": 15,
        "frameworkSpecificLifecycleOrchestrationSloc": 53,
        "cleanupSloc": 17,
        "nominalPluginCleanupActions": 2,
        "hostShutdownCleanupActions": 2,
        "failureRecoveryCleanupActions": 1,
    },
}


def descriptive(values: Iterable[float]) -> dict[str, float | int]:
    series = pd.Series(list(values), dtype="float64")
    q1 = float(series.quantile(0.25))
    q3 = float(series.quantile(0.75))
    return {
        "n": int(series.count()),
        "median": float(series.median()),
        "mean": float(series.mean()),
        "sd": float(series.std(ddof=1)),
        "q1": q1,
        "q3": q3,
        "iqr": q3 - q1,
        "p95": float(series.quantile(0.95)),
        "min": float(series.min()),
        "max": float(series.max()),
    }


def framework_descriptive(values: Iterable[float]) -> dict[str, float | int]:
    result = descriptive(values)
    result.pop("p95")
    return result


def prefixed_statistics(prefix: str, statistics: dict[str, float | int], unit: str) -> dict[str, float | int]:
    return {
        (f"{prefix}_n_cycles" if name == "n" else f"{prefix}_{name}_{unit}"): value
        for name, value in statistics.items()
    }


def write_csv(frame: pd.DataFrame, path: Path) -> None:
    frame.to_csv(path, index=False, encoding="utf-8", float_format="%.9f")


def build_rq2_replicate_summary(performance_runs: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for artifact in performance_runs:
        manifest = artifact["manifest"]
        row: dict[str, Any] = {
            "experiment_id": manifest["experimentId"],
            "run_id": manifest["runId"],
            "framework": manifest["framework"],
            "replicate": manifest["replicate"],
            "git_commit": manifest["gitCommit"],
        }
        for operation, source_field in OPERATIONS.items():
            values_us = [int(record[source_field]) / 1000.0 for record in artifact["records"]]
            row.update(prefixed_statistics(operation, descriptive(values_us), "us"))
        rows.append(row)
    return pd.DataFrame(rows).sort_values(["framework", "replicate"]).reset_index(drop=True)


def build_rq2_framework_summary(replicates: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for framework in FRAMEWORK_ORDER:
        framework_rows = replicates[replicates["framework"] == framework]
        for operation in OPERATIONS:
            statistics = framework_descriptive(framework_rows[f"{operation}_median_us"])
            row: dict[str, Any] = {
                "experiment_id": PERFORMANCE_EXPERIMENT_ID,
                "framework": framework,
                "operation": operation,
            }
            for name, value in statistics.items():
                row["n_replicates" if name == "n" else f"{name}_us"] = value
            rows.append(row)
    return pd.DataFrame(rows)


def build_rq2_paired_comparison(replicates: pd.DataFrame) -> pd.DataFrame:
    by_key = replicates.set_index(["framework", "replicate"])
    rows: list[dict[str, Any]] = []
    for replicate in range(1, 21):
        row: dict[str, Any] = {
            "experiment_id": PERFORMANCE_EXPERIMENT_ID,
            "replicate": replicate,
        }
        for operation in OPERATIONS:
            nestjs = float(by_key.loc[("nestjs", replicate), f"{operation}_median_us"])
            cordis = float(by_key.loc[("cordis", replicate), f"{operation}_median_us"])
            row[f"nestjs_{operation}_median_us"] = nestjs
            row[f"cordis_{operation}_median_us"] = cordis
            row[f"cordis_to_nestjs_{operation}_ratio"] = cordis / nestjs
            row[f"cordis_vs_nestjs_{operation}_percent_difference"] = (
                (cordis - nestjs) / nestjs * 100.0
            )
        rows.append(row)
    return pd.DataFrame(rows)


def build_rq2_stability(performance_runs: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for artifact in performance_runs:
        manifest = artifact["manifest"]
        for block_number, block in enumerate(artifact["stabilityDiagnostics"]["blocks"], start=1):
            rows.append(
                {
                    "experiment_id": manifest["experimentId"],
                    "run_id": manifest["runId"],
                    "framework": manifest["framework"],
                    "replicate": manifest["replicate"],
                    "block": block_number,
                    "start_cycle": block["startCycle"],
                    "end_cycle": block["endCycle"],
                    "median_load_us": int(block["medianLoadNanoseconds"]) / 1000.0,
                    "median_exercise_us": int(block["medianExerciseNanoseconds"]) / 1000.0,
                    "median_dispose_us": int(block["medianDisposeNanoseconds"]) / 1000.0,
                    "median_total_us": int(block["medianMeasuredTotalNanoseconds"]) / 1000.0,
                }
            )
    return pd.DataFrame(rows).sort_values(["framework", "replicate", "block"]).reset_index(drop=True)


def build_rq1_checkpoint_deltas(memory_runs: list[dict[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for artifact in memory_runs:
        manifest = artifact["manifest"]
        baseline = artifact["records"][0]
        for record in artifact["records"]:
            raw = {
                "heap_used": int(record["heapUsed"]),
                "rss": int(record["rss"]),
                "external": int(record["external"]),
                "array_buffers": int(record["arrayBuffers"]),
            }
            baseline_raw = {
                "heap_used": int(baseline["heapUsed"]),
                "rss": int(baseline["rss"]),
                "external": int(baseline["external"]),
                "array_buffers": int(baseline["arrayBuffers"]),
            }
            row: dict[str, Any] = {
                "experiment_id": manifest["experimentId"],
                "run_id": manifest["runId"],
                "framework": manifest["framework"],
                "replicate": manifest["replicate"],
                "checkpoint_cycle": record["checkpointCycle"],
                "forced_gc": record["forcedGc"],
                "heap_total_bytes": int(record["heapTotal"]),
                "heap_total_mib": int(record["heapTotal"]) / (1024**2),
                "active_subscriptions": record["ledger"]["activeSubscriptions"],
                "total_active_resources": record["ledger"]["totalActiveResources"],
                "active_owner_count": len(record["ledger"]["owners"]),
            }
            for metric, value in raw.items():
                delta = value - baseline_raw[metric]
                row[f"{metric}_bytes"] = value
                row[f"{metric}_mib"] = value / (1024**2)
                row[f"{metric}_delta_bytes"] = delta
                row[f"{metric}_delta_mib"] = delta / (1024**2)
                if metric in {"external", "array_buffers"}:
                    row[f"{metric}_kib"] = value / 1024
                    row[f"{metric}_delta_kib"] = delta / 1024
            rows.append(row)
    return pd.DataFrame(rows).sort_values(["framework", "replicate", "checkpoint_cycle"]).reset_index(drop=True)


def build_rq1_memory_summary(deltas: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for framework in FRAMEWORK_ORDER:
        for checkpoint in sorted(deltas["checkpoint_cycle"].unique()):
            subset = deltas[
                (deltas["framework"] == framework) & (deltas["checkpoint_cycle"] == checkpoint)
            ]
            for metric, source_column in MEMORY_METRICS.items():
                statistics = framework_descriptive(subset[source_column])
                row: dict[str, Any] = {
                    "experiment_id": MEMORY_EXPERIMENT_ID,
                    "framework": framework,
                    "checkpoint_cycle": int(checkpoint),
                    "metric": metric,
                }
                for name, value in statistics.items():
                    if name == "n":
                        row["n_replicates"] = value
                    else:
                        row[f"{name}_bytes"] = value
                        row[f"{name}_mib"] = float(value) / (1024**2)
                rows.append(row)
    return pd.DataFrame(rows)


def build_rq1_resource_summary(
    memory_runs: list[dict[str, Any]], deltas: pd.DataFrame
) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for framework in FRAMEWORK_ORDER:
        runs = [run for run in memory_runs if run["manifest"]["framework"] == framework]
        checkpoints = deltas[deltas["framework"] == framework]
        rows.append(
            {
                "experiment_id": MEMORY_EXPERIMENT_ID,
                "framework": framework,
                "final_memory_runs": len(runs),
                "registrations_verified_runs": sum(
                    bool(run["validation"]["registrationsVerified"]) for run in runs
                ),
                "expected_subscription_count": int(
                    pd.Series(
                        [run["validation"]["expectedSubscriptionsPerPlugin"] for run in runs]
                    ).mode().iloc[0]
                ),
                "maximum_observed_subscription_count": max(
                    run["validation"]["maximumObservedSubscriptions"] for run in runs
                ),
                "post_disposal_resource_failures": sum(
                    not bool(run["validation"]["resourcesReleased"]) for run in runs
                ),
                "checkpoints_with_nonzero_active_resources": int(
                    (
                        (checkpoints["active_subscriptions"] != 0)
                        | (checkpoints["total_active_resources"] != 0)
                        | (checkpoints["active_owner_count"] != 0)
                    ).sum()
                ),
            }
        )
    return pd.DataFrame(rows)


def configure_plot_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 10,
            "axes.titlesize": 11,
            "axes.labelsize": 10,
            "figure.titlesize": 12,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "axes.grid.axis": "y",
            "grid.color": "#D9D9D9",
            "grid.linewidth": 0.6,
            "grid.alpha": 0.7,
        }
    )


def add_boxplot_with_points(
    ax: plt.Axes,
    values_by_framework: list[np.ndarray],
    rng: np.random.Generator,
) -> None:
    boxes = ax.boxplot(
        values_by_framework,
        tick_labels=[FRAMEWORK_LABELS[item] for item in FRAMEWORK_ORDER],
        widths=0.5,
        patch_artist=True,
        showfliers=False,
        medianprops={"color": "#111111", "linewidth": 1.5},
        whiskerprops={"color": "#555555"},
        capprops={"color": "#555555"},
    )
    for patch, framework in zip(boxes["boxes"], FRAMEWORK_ORDER, strict=True):
        patch.set_facecolor(FRAMEWORK_COLORS[framework])
        patch.set_alpha(0.45)
        patch.set_edgecolor(FRAMEWORK_COLORS[framework])
    for position, (framework, values) in enumerate(
        zip(FRAMEWORK_ORDER, values_by_framework, strict=True), start=1
    ):
        offsets = rng.uniform(-0.09, 0.09, size=len(values))
        ax.scatter(
            np.full(len(values), position) + offsets,
            values,
            s=22,
            color=FRAMEWORK_COLORS[framework],
            edgecolor="white",
            linewidth=0.35,
            alpha=0.9,
            zorder=3,
        )


def create_rq2_figures(replicates: pd.DataFrame) -> list[Path]:
    outputs: list[Path] = []
    configure_plot_style()
    rng = np.random.default_rng(JITTER_SEED)
    total_values = [
        replicates.loc[replicates["framework"] == framework, "total_median_us"].to_numpy()
        for framework in FRAMEWORK_ORDER
    ]
    fig, ax = plt.subplots(figsize=(6.2, 4.5), constrained_layout=True)
    add_boxplot_with_points(ax, total_values, rng)
    ax.set_title("Median total lifecycle latency by process replicate")
    ax.set_xlabel("Framework")
    ax.set_ylabel("Median lifecycle latency (µs)")
    for extension in ("pdf", "png"):
        path = FIGURES_ROOT / f"rq2_total_latency.{extension}"
        fig.savefig(path, dpi=300 if extension == "png" else None, bbox_inches="tight")
        outputs.append(path)
    plt.close(fig)

    fig, axes = plt.subplots(1, 3, figsize=(11.2, 4.2), constrained_layout=True)
    for ax, operation in zip(axes, ("load", "exercise", "dispose"), strict=True):
        operation_values = [
            replicates.loc[
                replicates["framework"] == framework, f"{operation}_median_us"
            ].to_numpy()
            for framework in FRAMEWORK_ORDER
        ]
        add_boxplot_with_points(ax, operation_values, rng)
        ax.set_title(operation.capitalize())
        ax.set_xlabel("Framework")
        ax.set_ylabel("Replicate median (µs)")
    fig.suptitle("Lifecycle operation latency by process replicate")
    for extension in ("pdf", "png"):
        path = FIGURES_ROOT / f"rq2_operation_latency.{extension}"
        fig.savefig(path, dpi=300 if extension == "png" else None, bbox_inches="tight")
        outputs.append(path)
    plt.close(fig)
    return outputs


def create_rq1_figure(deltas: pd.DataFrame) -> list[Path]:
    configure_plot_style()
    outputs: list[Path] = []
    fig, ax = plt.subplots(figsize=(7.2, 4.7), constrained_layout=True)
    for framework in FRAMEWORK_ORDER:
        subset = deltas[deltas["framework"] == framework]
        grouped = subset.groupby("checkpoint_cycle")["heap_used_delta_mib"]
        checkpoints = np.array(sorted(subset["checkpoint_cycle"].unique()), dtype=float)
        medians = grouped.median().reindex(checkpoints).to_numpy()
        q1 = grouped.quantile(0.25).reindex(checkpoints).to_numpy()
        q3 = grouped.quantile(0.75).reindex(checkpoints).to_numpy()
        color = FRAMEWORK_COLORS[framework]
        ax.plot(
            checkpoints,
            medians,
            marker="o",
            linewidth=2,
            markersize=4,
            color=color,
            label=FRAMEWORK_LABELS[framework],
        )
        ax.fill_between(checkpoints, q1, q3, color=color, alpha=0.18, linewidth=0)
    ax.set_title("Post-GC heap-used change from process baseline")
    ax.set_xlabel("Completed lifecycle cycles")
    ax.set_ylabel("Heap-used delta (MiB)")
    ax.set_xticks([0, 100, 250, 500, 1000, 1500, 2000])
    ax.legend(frameon=False, loc="upper left")
    for extension in ("pdf", "png"):
        path = FIGURES_ROOT / f"rq1_heap_used_delta.{extension}"
        fig.savefig(path, dpi=300 if extension == "png" else None, bbox_inches="tight")
        outputs.append(path)
    plt.close(fig)
    return outputs


def verify_rq3_frozen_sources() -> dict[str, Any]:
    command = [
        "git",
        "diff",
        "--exit-code",
        "--no-ext-diff",
        EXPECTED_GIT_COMMIT,
        "--",
        *RQ3_GUARDED_PATHS,
    ]
    completed = subprocess.run(
        command,
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if completed.returncode == 1:
        changed = subprocess.run(
            ["git", "diff", "--name-only", EXPECTED_GIT_COMMIT, "--", *RQ3_GUARDED_PATHS],
            cwd=REPOSITORY_ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout.strip()
        raise RuntimeError(
            "RQ3 frozen-source guard failed. These files differ from benchmark commit "
            f"{EXPECTED_GIT_COMMIT}: {changed or '<unknown>'}. Final RQ3 metrics were not generated."
        )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "unknown Git error"
        raise RuntimeError(f"RQ3 frozen-source guard could not run: {detail}")
    return {
        "status": "passed",
        "benchmarkGitCommit": EXPECTED_GIT_COMMIT,
        "guardedPaths": RQ3_GUARDED_PATHS,
    }


def run_rq3_counter() -> dict[str, Any]:
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if npm is None:
        raise RuntimeError("npm is required to run the frozen RQ3 counter")
    completed = subprocess.run(
        [npm, "run", "rq3:count"],
        cwd=REPOSITORY_ROOT / "01_testbed",
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    output = completed.stdout
    start = output.find("{")
    if start < 0:
        raise RuntimeError("The RQ3 counter did not emit JSON")
    result = json.loads(output[start:])
    if result.get("countingRuleVersion") != "rq3-sloc-v2":
        raise RuntimeError("The RQ3 counter did not use rq3-sloc-v2")
    for framework, expected in EXPECTED_RQ3_METRICS.items():
        actual = result.get("frameworks", {}).get(framework, {})
        differences = {
            name: {"expected": value, "actual": actual.get(name)}
            for name, value in expected.items()
            if actual.get(name) != value
        }
        if differences:
            raise RuntimeError(
                f"RQ3 final metrics for {framework} differ from the audited values: {differences}"
            )
    return result


def rq3_dataframe(result: dict[str, Any]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for framework in FRAMEWORK_ORDER:
        metrics = result["frameworks"][framework]
        rows.append(
            {
                "rule_version": result["countingRuleVersion"],
                "framework": framework,
                "plugin_lifecycle_sloc": metrics["pluginLifecycleSloc"],
                "framework_lifecycle_orchestration_sloc": metrics[
                    "frameworkSpecificLifecycleOrchestrationSloc"
                ],
                "cleanup_sloc": metrics["cleanupSloc"],
                "nominal_plugin_cleanup_actions": metrics["nominalPluginCleanupActions"],
                "host_shutdown_cleanup_actions": metrics["hostShutdownCleanupActions"],
                "failure_recovery_cleanup_actions": metrics["failureRecoveryCleanupActions"],
            }
        )
    return pd.DataFrame(rows)


def git_state() -> tuple[str | None, bool | None]:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout.strip()
        status = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=all"],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout.strip()
        return commit, bool(status)
    except (OSError, subprocess.CalledProcessError):
        return None, None


def resolve_git_ref(ref: str) -> str | None:
    try:
        return subprocess.run(
            ["git", "rev-parse", f"{ref}^{{commit}}"],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def format_value(value: float, digits: int = 3) -> str:
    return f"{value:.{digits}f}"


def write_fact_sheet(
    audit: dict[str, Any],
    rq2_framework: pd.DataFrame,
    rq2_paired: pd.DataFrame,
    rq1_summary: pd.DataFrame,
    resource_summary: pd.DataFrame,
    rq3_metrics: pd.DataFrame,
) -> Path:
    lines = ["# Final results fact sheet", "", "## RQ1", ""]
    for framework in FRAMEWORK_ORDER:
        label = FRAMEWORK_LABELS[framework]
        for metric in ("heap_used_delta", "rss_delta", "external_delta", "array_buffers_delta"):
            row = rq1_summary[
                (rq1_summary["framework"] == framework)
                & (rq1_summary["checkpoint_cycle"] == 2000)
                & (rq1_summary["metric"] == metric)
            ].iloc[0]
            lines.append(
                f"- {label} checkpoint-2000 {metric.replace('_', ' ')}: median "
                f"{format_value(row['median_mib'])} MiB, IQR {format_value(row['iqr_mib'])} MiB "
                "(`rq1_memory_summary.csv`)."
            )
        cleanup = resource_summary[resource_summary["framework"] == framework].iloc[0]
        lines.append(
            f"- {label}: {int(cleanup['checkpoints_with_nonzero_active_resources'])} checkpoints "
            f"with non-zero controlled resources and {int(cleanup['post_disposal_resource_failures'])} "
            "run-level post-disposal resource failures (`rq1_resource_cleanup_summary.csv`)."
        )

    lines.extend(["", "## RQ2", ""])
    for framework in FRAMEWORK_ORDER:
        label = FRAMEWORK_LABELS[framework]
        for operation in OPERATIONS:
            row = rq2_framework[
                (rq2_framework["framework"] == framework)
                & (rq2_framework["operation"] == operation)
            ].iloc[0]
            lines.append(
                f"- {label} {operation}: median of 20 process-replicate medians "
                f"{format_value(row['median_us'])} µs, IQR {format_value(row['iqr_us'])} µs "
                "(`rq2_framework_summary.csv`)."
            )
    lines.append(
        f"- Paired total-latency ratio (Cordis/NestJS): median "
        f"{format_value(rq2_paired['cordis_to_nestjs_total_ratio'].median())}; median paired "
        f"percentage difference {format_value(rq2_paired['cordis_vs_nestjs_total_percent_difference'].median())}% "
        "(`rq2_paired_comparison.csv`)."
    )

    lines.extend(["", "## RQ3", ""])
    for _, row in rq3_metrics.iterrows():
        label = FRAMEWORK_LABELS[row["framework"]]
        lines.append(
            f"- {label}: plugin lifecycle {int(row['plugin_lifecycle_sloc'])} SLOC, framework "
            f"orchestration {int(row['framework_lifecycle_orchestration_sloc'])} SLOC, cleanup "
            f"{int(row['cleanup_sloc'])} SLOC, nominal/host/failure actions "
            f"{int(row['nominal_plugin_cleanup_actions'])}/{int(row['host_shutdown_cleanup_actions'])}/"
            f"{int(row['failure_recovery_cleanup_actions'])} (`rq3_final_metrics.csv`)."
        )

    lines.extend(
        [
            "",
            "## Diagnostic supporting evidence",
            "",
            "- The 10,000-cycle exploratory memory run and heap snapshots are excluded from every primary RQ1 and RQ2 table. This pipeline reads only the two allowlisted final experiment directories (`final_data_audit.json`).",
            "- Diagnostic object-retention findings remain separate supporting evidence and are not pooled with final replicate statistics (`analysis_manifest.json`).",
            "",
            "## Reliability / validity observations",
            "",
            f"- The validation gate passed for {audit['performanceBatch']['completed']} performance runs and {audit['memoryBatch']['completed']} memory runs (`final_data_audit.json`).",
            f"- All final runs used benchmark commit `{audit['gitCommit']}` and package-lock SHA-256 `{audit['packageLockSha256']}` (`final_data_audit.json`).",
            f"- The {audit['rawInputFileCount']} allowlisted JSON files have aggregate SHA-256 `{audit['rawInputAggregateSha256']}` (`final_data_audit.json`).",
            "- RQ2 framework summaries use one cycle median per fresh process replicate. The 2,000 cycles within a process are not treated as independent replicates (`rq2_replicate_summary.csv`).",
            "- Memory growth and controlled-resource cleanup are reported separately; zero ledger counts do not classify process-memory behavior as leak-free (`rq1_resource_cleanup_summary.csv`, `rq1_memory_summary.csv`).",
        ]
    )
    path = PROCESSED_ROOT / "final_results_facts.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def relative_paths(paths: Iterable[Path]) -> list[str]:
    return [path.relative_to(REPOSITORY_ROOT).as_posix() for path in paths]


def main() -> int:
    analysis_started_at = datetime.now(timezone.utc).isoformat()
    analysis_source_commit, analysis_source_dirty = git_state()
    if analysis_source_commit is None or analysis_source_dirty is None:
        print("Analysis source Git provenance could not be captured.", file=sys.stderr)
        return 1
    benchmark_tag_commit = resolve_git_ref(BENCHMARK_TAG)

    try:
        validated = validate_final(write_reports=True)
    except FinalDataValidationError as error:
        print(str(error), file=sys.stderr)
        for item in error.errors:
            print(f"ERROR: {item}", file=sys.stderr)
        return 1

    try:
        rq3_guard = verify_rq3_frozen_sources()
        rq3_result = run_rq3_counter()
    except (OSError, RuntimeError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"Final RQ3 generation aborted: {error}", file=sys.stderr)
        return 1

    PROCESSED_ROOT.mkdir(parents=True, exist_ok=True)
    FIGURES_ROOT.mkdir(parents=True, exist_ok=True)

    generated_processed: list[Path] = [
        PROCESSED_ROOT / "final_data_audit.json",
        PROCESSED_ROOT / "final_data_audit.txt",
    ]

    rq2_replicates = build_rq2_replicate_summary(validated["performanceRuns"])
    rq2_framework = build_rq2_framework_summary(rq2_replicates)
    rq2_paired = build_rq2_paired_comparison(rq2_replicates)
    rq2_stability = build_rq2_stability(validated["performanceRuns"])
    rq2_outputs = {
        "rq2_replicate_summary.csv": rq2_replicates,
        "rq2_framework_summary.csv": rq2_framework,
        "rq2_paired_comparison.csv": rq2_paired,
        "rq2_stability_summary.csv": rq2_stability,
    }
    for filename, frame in rq2_outputs.items():
        path = PROCESSED_ROOT / filename
        write_csv(frame, path)
        generated_processed.append(path)

    rq1_deltas = build_rq1_checkpoint_deltas(validated["memoryRuns"])
    rq1_summary = build_rq1_memory_summary(rq1_deltas)
    resource_summary = build_rq1_resource_summary(validated["memoryRuns"], rq1_deltas)
    cycle2000 = rq1_summary[rq1_summary["checkpoint_cycle"] == 2000].reset_index(drop=True)
    rq1_outputs = {
        "rq1_checkpoint_deltas.csv": rq1_deltas,
        "rq1_memory_summary.csv": rq1_summary,
        "rq1_resource_cleanup_summary.csv": resource_summary,
        "rq1_cycle2000_memory_comparison.csv": cycle2000,
    }
    for filename, frame in rq1_outputs.items():
        path = PROCESSED_ROOT / filename
        write_csv(frame, path)
        generated_processed.append(path)

    rq3_json_path = PROCESSED_ROOT / "rq3_final_metrics.json"
    rq3_json_path.write_text(json.dumps(rq3_result, indent=2) + "\n", encoding="utf-8")
    rq3_metrics = rq3_dataframe(rq3_result)
    rq3_csv_path = PROCESSED_ROOT / "rq3_final_metrics.csv"
    write_csv(rq3_metrics, rq3_csv_path)
    generated_processed.extend([rq3_json_path, rq3_csv_path])

    generated_figures = [
        *create_rq2_figures(rq2_replicates),
        *create_rq1_figure(rq1_deltas),
    ]
    fact_sheet_path = write_fact_sheet(
        validated["audit"],
        rq2_framework,
        rq2_paired,
        rq1_summary,
        resource_summary,
        rq3_metrics,
    )
    generated_processed.append(fact_sheet_path)

    manifest_path = PROCESSED_ROOT / "analysis_manifest.json"
    generated_processed.append(manifest_path)
    manifest = {
        "schemaVersion": 2,
        "analysisScriptVersion": ANALYSIS_VERSION,
        "analysisStartedAt": analysis_started_at,
        "analysisCompletedAt": datetime.now(timezone.utc).isoformat(),
        "analysisSourceGitCommit": analysis_source_commit,
        "analysisSourceWorkingTreeDirty": analysis_source_dirty,
        "inputExperimentIds": {
            "performance": PERFORMANCE_EXPERIMENT_ID,
            "memory": MEMORY_EXPERIMENT_ID,
        },
        "inputPaths": {
            "performance": PERFORMANCE_ROOT.relative_to(REPOSITORY_ROOT).as_posix(),
            "memory": MEMORY_ROOT.relative_to(REPOSITORY_ROOT).as_posix(),
        },
        "rawInputAggregateSha256": validated["audit"]["rawInputAggregateSha256"],
        "benchmarkGitCommit": EXPECTED_GIT_COMMIT,
        "benchmarkTag": BENCHMARK_TAG,
        "benchmarkTagResolvedCommit": benchmark_tag_commit,
        "benchmarkTagMatchesFrozenCommit": benchmark_tag_commit == EXPECTED_GIT_COMMIT,
        "benchmarkPackageLockSha256": EXPECTED_PACKAGE_LOCK_SHA256,
        "generatedProcessedFiles": relative_paths(generated_processed),
        "generatedFigures": relative_paths(generated_figures),
        "rq3RuleVersion": rq3_result["countingRuleVersion"],
        "rq3FrozenSourceGuard": rq3_guard,
        "rq2PointJitter": {
            "method": "fixed-seed pseudo-random horizontal jitter independent of latency values",
            "seed": JITTER_SEED,
        },
        "statisticalUnit": "fresh Node.js process replicate",
        "diagnosticDataIncludedInPrimaryStatistics": False,
        "pythonVersion": sys.version.split()[0],
        "libraryVersions": {
            "pandas": pd.__version__,
            "numpy": np.__version__,
            "matplotlib": matplotlib.__version__,
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print("Final analysis completed after validation.")
    print(f"RQ2 replicate rows: {len(rq2_replicates)}")
    print(f"RQ1 checkpoint rows: {len(rq1_deltas)}")
    print(f"Processed files: {len(generated_processed)}")
    print(f"Figures: {len(generated_figures)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
