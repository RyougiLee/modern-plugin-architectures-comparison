#!/usr/bin/env python3
"""Validate the two allowlisted final benchmark experiments."""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PERFORMANCE_EXPERIMENT_ID = "final-20260920172537463-8e9f6c97"
MEMORY_EXPERIMENT_ID = "final-20260920172714537-a5a8831b"
PERFORMANCE_ROOT = (
    REPOSITORY_ROOT / "02_data" / "raw" / "final" / "schema-v2" / PERFORMANCE_EXPERIMENT_ID
)
MEMORY_ROOT = (
    REPOSITORY_ROOT / "02_data" / "raw" / "final" / "schema-v2" / MEMORY_EXPERIMENT_ID
)
PROCESSED_ROOT = REPOSITORY_ROOT / "02_data" / "processed"

EXPECTED_GIT_COMMIT = "5dab909c7ebcc08046e5aa23bac29815b605e48b"
EXPECTED_PACKAGE_LOCK_SHA256 = "09df3eb847d97ae0852e56f8f0b31c20e0e977a55c4c95b65b0b03b0e87d8263"
EXPECTED_RAW_INPUT_AGGREGATE_SHA256 = "307123daea13d1981afdab6793249025efcf968c8f50405b9520745e553ef64e"
EXPECTED_NODE_VERSION = "v24.18.0"
EXPECTED_PACKAGE_VERSIONS = {
    "@nestjs/common": "11.2.5",
    "@nestjs/core": "11.2.5",
    "cordis": "3.18.1",
    "typescript": "5.9.3",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2",
}
EXPECTED_CHECKPOINTS = [0, 100, 250, 500, 1000, 1500, 2000]

CHECKS_PERFORMED = [
    "allowlisted experiment paths only",
    "batch phase, status, and run counts",
    "framework composition and exact replicate coverage",
    "run-to-batch identity and artifact path containment",
    "final workload and suite parameters",
    "performance record count and cycle coverage",
    "performance delivery count and timing-sum identity",
    "performance cross-framework checksum equivalence by replicate and cycle",
    "recorded stability block coverage and medians",
    "memory checkpoint coverage and forced-GC flags",
    "memory checkpoint resource-ledger zero state",
    "memory diagnostic deltas against checkpoint 0",
    "run-level checksum, registration, subscription, and cleanup validation",
    "Git commit and clean benchmark working tree",
    "package-lock SHA-256 consistency",
    "Node.js and framework/package versions",
    "CPU, OS, and architecture consistency",
    "expected artifact set without missing or additional run JSON",
]


class FinalDataValidationError(RuntimeError):
    """Raised when the final-data validation gate fails."""

    def __init__(self, errors: list[str]):
        super().__init__(f"Final-data validation failed with {len(errors)} error(s).")
        self.errors = errors


@dataclass
class ValidationState:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def expect(self, condition: bool, message: str) -> None:
        if not condition:
            self.errors.append(message)


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return value


def integer_median(values: list[int]) -> int:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) // 2


def dataset_digest(paths: list[Path]) -> str:
    lines: list[str] = []
    for path in sorted(paths, key=lambda item: item.as_posix()):
        file_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        relative = path.relative_to(REPOSITORY_ROOT).as_posix()
        lines.append(f"{file_hash}  {relative}")
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def validate_batch(
    root: Path,
    experiment_id: str,
    suite: str,
    expected_run_count: int,
    expected_per_framework: int,
    state: ValidationState,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[Path]]:
    batch_path = root / "batch-manifest.json"
    state.expect(root.is_dir(), f"Missing experiment directory: {root}")
    state.expect(batch_path.is_file(), f"Missing batch manifest: {batch_path}")
    if not batch_path.is_file():
        return {}, [], []

    batch = read_json(batch_path)
    expected_batch_fields = {
        "schemaVersion": 2,
        "experimentId": experiment_id,
        "phase": "final",
        "status": "completed",
        "plannedRunCount": expected_run_count,
        "completedRunCount": expected_run_count,
        "failedRunCount": 0,
        "incompleteRunCount": 0,
    }
    for name, expected in expected_batch_fields.items():
        state.expect(
            batch.get(name) == expected,
            f"{experiment_id} batch {name}: expected {expected!r}, found {batch.get(name)!r}",
        )

    batch_runs = batch.get("runs")
    state.expect(isinstance(batch_runs, list), f"{experiment_id} batch runs must be a list")
    if not isinstance(batch_runs, list):
        return batch, [], [batch_path]
    state.expect(
        len(batch_runs) == expected_run_count,
        f"{experiment_id} batch run list has {len(batch_runs)} entries, expected {expected_run_count}",
    )

    framework_counts = Counter(run.get("framework") for run in batch_runs)
    state.expect(
        framework_counts == Counter({"nestjs": expected_per_framework, "cordis": expected_per_framework}),
        f"{experiment_id} framework composition is {dict(framework_counts)}",
    )
    for framework in ("nestjs", "cordis"):
        replicates = sorted(
            run.get("replicate") for run in batch_runs if run.get("framework") == framework
        )
        state.expect(
            replicates == list(range(1, expected_per_framework + 1)),
            f"{experiment_id}/{framework} replicate coverage is {replicates}",
        )

    loaded_runs: list[dict[str, Any]] = []
    artifact_paths: list[Path] = []
    seen_run_ids: set[str] = set()
    for batch_run in batch_runs:
        run_id = batch_run.get("runId")
        state.expect(isinstance(run_id, str) and run_id not in seen_run_ids, f"Duplicate/invalid run ID {run_id!r}")
        if isinstance(run_id, str):
            seen_run_ids.add(run_id)
        state.expect(batch_run.get("suite") == suite, f"{run_id} batch suite is not {suite}")
        state.expect(batch_run.get("status") == "completed", f"{run_id} batch status is not completed")
        state.expect(batch_run.get("failure") is None, f"{run_id} has persisted failure data")

        relative_path = batch_run.get("artifactPath")
        if not isinstance(relative_path, str):
            state.errors.append(f"{run_id} has no artifactPath")
            continue
        artifact_path = (root / relative_path).resolve()
        try:
            artifact_path.relative_to(root.resolve())
        except ValueError:
            state.errors.append(f"{run_id} artifact path escapes its experiment directory")
            continue
        state.expect(artifact_path.is_file(), f"Missing artifact for {run_id}: {relative_path}")
        if not artifact_path.is_file():
            continue
        artifact_paths.append(artifact_path)
        artifact = read_json(artifact_path)
        manifest = artifact.get("manifest", {})
        state.expect(manifest.get("runId") == run_id, f"Run ID mismatch in {relative_path}")
        state.expect(manifest.get("experimentId") == experiment_id, f"Experiment ID mismatch in {relative_path}")
        state.expect(manifest.get("framework") == batch_run.get("framework"), f"Framework mismatch in {relative_path}")
        state.expect(manifest.get("replicate") == batch_run.get("replicate"), f"Replicate mismatch in {relative_path}")
        loaded_runs.append(artifact)

    expected_artifacts = set(artifact_paths)
    actual_artifacts = set((root / suite).glob("*/*.json")) if (root / suite).is_dir() else set()
    state.expect(
        actual_artifacts == expected_artifacts,
        f"{experiment_id} run artifact set differs from the completed batch manifest",
    )
    return batch, loaded_runs, [batch_path, *artifact_paths]


def validate_common_run(
    artifact: dict[str, Any],
    suite: str,
    experiment_id: str,
    state: ValidationState,
) -> None:
    manifest = artifact.get("manifest", {})
    validation = artifact.get("validation", {})
    run_id = manifest.get("runId", "<unknown-run>")
    expected_manifest = {
        "schemaVersion": 2,
        "experimentId": experiment_id,
        "phase": "final",
        "suite": suite,
        "scenario": "nominal",
        "gitCommit": EXPECTED_GIT_COMMIT,
        "workingTreeDirty": False,
        "packageLockSha256": EXPECTED_PACKAGE_LOCK_SHA256,
        "nodeVersion": EXPECTED_NODE_VERSION,
    }
    for name, expected in expected_manifest.items():
        state.expect(
            manifest.get(name) == expected,
            f"{run_id} manifest {name}: expected {expected!r}, found {manifest.get(name)!r}",
        )
    for package, version in EXPECTED_PACKAGE_VERSIONS.items():
        actual = manifest.get("packageVersions", {}).get(package)
        state.expect(actual == version, f"{run_id} package {package}: expected {version}, found {actual}")
    expected_validation = {
        "checksumsVerified": True,
        "registrationsVerified": True,
        "expectedSubscriptionsPerPlugin": 4,
        "maximumObservedSubscriptions": 4,
        "resourcesReleased": True,
    }
    for name, expected in expected_validation.items():
        state.expect(
            validation.get(name) == expected,
            f"{run_id} validation {name}: expected {expected!r}, found {validation.get(name)!r}",
        )


def validate_performance_run(artifact: dict[str, Any], state: ValidationState) -> None:
    validate_common_run(artifact, "performance", PERFORMANCE_EXPERIMENT_ID, state)
    manifest = artifact.get("manifest", {})
    validation = artifact.get("validation", {})
    records = artifact.get("records")
    run_id = manifest.get("runId", "<unknown-run>")
    expected_parameters = {
        "payloadSizeBytes": 4096,
        "subscriptionCount": 4,
        "eventCount": 32,
        "warmupCycles": 1000,
        "measuredCycles": 2000,
    }
    parameters = manifest.get("parameters", {})
    for name, expected in expected_parameters.items():
        state.expect(parameters.get(name) == expected, f"{run_id} parameter {name} is not {expected}")
    state.expect(manifest.get("forcedGc") is False, f"{run_id} performance forcedGc is not false")
    state.expect(validation.get("completedCycles") == 2000, f"{run_id} did not complete 2000 cycles")
    state.expect(validation.get("expectedCycles") == 2000, f"{run_id} expectedCycles is not 2000")
    state.expect(validation.get("warmupCyclesCompleted") == 1000, f"{run_id} did not complete 1000 warm-ups")
    state.expect(isinstance(records, list) and len(records) == 2000, f"{run_id} does not contain 2000 records")
    if not isinstance(records, list) or len(records) != 2000:
        return
    state.expect([record.get("cycle") for record in records] == list(range(1, 2001)), f"{run_id} cycle indices are incomplete or unordered")
    for record in records:
        cycle = record.get("cycle")
        state.expect(record.get("deliveredEvents") == 128, f"{run_id} cycle {cycle} deliveredEvents is not 128")
        try:
            load = int(record["loadNanoseconds"])
            exercise = int(record["exerciseNanoseconds"])
            dispose = int(record["disposeNanoseconds"])
            total = int(record["measuredTotalNanoseconds"])
            state.expect(total == load + exercise + dispose, f"{run_id} cycle {cycle} timing sum mismatch")
        except (KeyError, TypeError, ValueError):
            state.errors.append(f"{run_id} cycle {cycle} contains invalid timing fields")

    diagnostics = artifact.get("stabilityDiagnostics", {})
    blocks = diagnostics.get("blocks")
    state.expect(diagnostics.get("blockCount") == 10, f"{run_id} stability blockCount is not 10")
    state.expect(isinstance(blocks, list) and len(blocks) == 10, f"{run_id} stability blocks are missing")
    if isinstance(blocks, list) and len(blocks) == 10:
        covered_cycles: list[int] = []
        timing_fields = {
            "medianLoadNanoseconds": "loadNanoseconds",
            "medianExerciseNanoseconds": "exerciseNanoseconds",
            "medianDisposeNanoseconds": "disposeNanoseconds",
            "medianMeasuredTotalNanoseconds": "measuredTotalNanoseconds",
        }
        for block in blocks:
            start = block.get("startCycle")
            end = block.get("endCycle")
            if not isinstance(start, int) or not isinstance(end, int) or start > end:
                state.errors.append(f"{run_id} has invalid stability block bounds")
                continue
            covered_cycles.extend(range(start, end + 1))
            for diagnostic_field, record_field in timing_fields.items():
                values = [int(records[index - 1][record_field]) for index in range(start, end + 1)]
                expected = integer_median(values)
                try:
                    actual = int(block[diagnostic_field])
                except (KeyError, TypeError, ValueError):
                    state.errors.append(f"{run_id} has invalid {diagnostic_field}")
                    continue
                state.expect(actual == expected, f"{run_id} block {start}-{end} {diagnostic_field} mismatch")
        state.expect(covered_cycles == list(range(1, 2001)), f"{run_id} stability blocks do not cover cycles 1..2000 exactly once")


def validate_memory_run(artifact: dict[str, Any], state: ValidationState) -> None:
    validate_common_run(artifact, "memory", MEMORY_EXPERIMENT_ID, state)
    manifest = artifact.get("manifest", {})
    validation = artifact.get("validation", {})
    records = artifact.get("records")
    run_id = manifest.get("runId", "<unknown-run>")
    expected_parameters = {
        "payloadSizeBytes": 4096,
        "subscriptionCount": 4,
        "eventCount": 32,
        "memoryWarmupCycles": 100,
        "lifecycleCycles": 2000,
        "checkpoints": EXPECTED_CHECKPOINTS,
        "forceGc": True,
    }
    parameters = manifest.get("parameters", {})
    for name, expected in expected_parameters.items():
        state.expect(parameters.get(name) == expected, f"{run_id} parameter {name} is not {expected!r}")
    state.expect(manifest.get("forcedGc") is True, f"{run_id} memory forcedGc is not true")
    state.expect(validation.get("completedCycles") == 2000, f"{run_id} did not complete 2000 cycles")
    state.expect(validation.get("expectedCycles") == 2000, f"{run_id} expectedCycles is not 2000")
    state.expect(validation.get("warmupCyclesCompleted") == 100, f"{run_id} did not complete 100 warm-ups")
    state.expect(isinstance(records, list) and len(records) == 7, f"{run_id} does not contain 7 checkpoints")
    if not isinstance(records, list) or len(records) != 7:
        return
    state.expect([record.get("checkpointCycle") for record in records] == EXPECTED_CHECKPOINTS, f"{run_id} checkpoints do not match the frozen sequence")
    for record in records:
        checkpoint = record.get("checkpointCycle")
        ledger = record.get("ledger", {})
        state.expect(record.get("forcedGc") is True, f"{run_id} checkpoint {checkpoint} forcedGc is not true")
        state.expect(ledger.get("activeSubscriptions") == 0, f"{run_id} checkpoint {checkpoint} has active subscriptions")
        state.expect(ledger.get("totalActiveResources") == 0, f"{run_id} checkpoint {checkpoint} has active resources")
        state.expect(ledger.get("owners") == [], f"{run_id} checkpoint {checkpoint} has active owners")

    diagnostics = artifact.get("memoryDiagnostics", {})
    deltas = diagnostics.get("checkpointDeltas")
    state.expect(diagnostics.get("baselineCheckpointCycle") == 0, f"{run_id} memory diagnostic baseline is not 0")
    state.expect(isinstance(deltas, list) and len(deltas) == 7, f"{run_id} memory diagnostic deltas are missing")
    if isinstance(deltas, list) and len(deltas) == 7:
        baseline = records[0]
        metric_pairs = {
            "heapUsedDeltaFromBaseline": "heapUsed",
            "rssDeltaFromBaseline": "rss",
            "externalDeltaFromBaseline": "external",
            "arrayBuffersDeltaFromBaseline": "arrayBuffers",
        }
        for record, delta in zip(records, deltas, strict=True):
            state.expect(delta.get("checkpointCycle") == record.get("checkpointCycle"), f"{run_id} memory diagnostic checkpoint mismatch")
            for delta_name, raw_name in metric_pairs.items():
                expected = record.get(raw_name) - baseline.get(raw_name)
                state.expect(delta.get(delta_name) == expected, f"{run_id} checkpoint {record.get('checkpointCycle')} {delta_name} mismatch")


def validate_final(write_reports: bool = True) -> dict[str, Any]:
    state = ValidationState()
    performance_batch, performance_runs, performance_files = validate_batch(
        PERFORMANCE_ROOT,
        PERFORMANCE_EXPERIMENT_ID,
        "performance",
        40,
        20,
        state,
    )
    memory_batch, memory_runs, memory_files = validate_batch(
        MEMORY_ROOT,
        MEMORY_EXPERIMENT_ID,
        "memory",
        20,
        10,
        state,
    )
    for artifact in performance_runs:
        validate_performance_run(artifact, state)
    for artifact in memory_runs:
        validate_memory_run(artifact, state)

    performance_by_key = {
        (artifact["manifest"]["framework"], artifact["manifest"]["replicate"]): artifact
        for artifact in performance_runs
    }
    for replicate in range(1, 21):
        nestjs = performance_by_key.get(("nestjs", replicate))
        cordis = performance_by_key.get(("cordis", replicate))
        if nestjs is None or cordis is None:
            state.errors.append(f"Cannot compare checksums for performance replicate {replicate}")
            continue
        nestjs_checksums = [record.get("checksum") for record in nestjs.get("records", [])]
        cordis_checksums = [record.get("checksum") for record in cordis.get("records", [])]
        state.expect(
            nestjs_checksums == cordis_checksums,
            f"Performance replicate {replicate} has cross-framework checksum differences",
        )

    all_runs = [*performance_runs, *memory_runs]
    environment_signatures = {
        json.dumps(artifact.get("manifest", {}).get("operatingSystem"), sort_keys=True)
        for artifact in all_runs
    }
    state.expect(len(environment_signatures) == 1, "CPU/OS/architecture metadata differ across final runs")
    git_commits = {artifact.get("manifest", {}).get("gitCommit") for artifact in all_runs}
    lock_hashes = {artifact.get("manifest", {}).get("packageLockSha256") for artifact in all_runs}
    state.expect(git_commits == {EXPECTED_GIT_COMMIT}, f"Final-run Git commits differ: {git_commits}")
    state.expect(lock_hashes == {EXPECTED_PACKAGE_LOCK_SHA256}, f"Final-run package-lock hashes differ: {lock_hashes}")

    all_input_files = [*performance_files, *memory_files]
    raw_input_digest = dataset_digest(all_input_files)
    state.expect(
        raw_input_digest == EXPECTED_RAW_INPUT_AGGREGATE_SHA256,
        "Final raw-input aggregate SHA-256 differs from the audited value: "
        f"expected {EXPECTED_RAW_INPUT_AGGREGATE_SHA256}, found {raw_input_digest}",
    )

    if state.errors:
        raise FinalDataValidationError(state.errors)

    environment = all_runs[0]["manifest"]["operatingSystem"] if all_runs else None
    audit = {
        "schemaVersion": 1,
        "validationStatus": "passed",
        "performanceExperimentId": PERFORMANCE_EXPERIMENT_ID,
        "memoryExperimentId": MEMORY_EXPERIMENT_ID,
        "gitCommit": EXPECTED_GIT_COMMIT,
        "packageLockSha256": EXPECTED_PACKAGE_LOCK_SHA256,
        "rawInputFileCount": len(all_input_files),
        "rawInputAggregateSha256": raw_input_digest,
        "performanceBatch": {
            "planned": performance_batch["plannedRunCount"],
            "completed": performance_batch["completedRunCount"],
            "failed": performance_batch["failedRunCount"],
            "incomplete": performance_batch["incompleteRunCount"],
            "frameworkRunCounts": dict(Counter(run["manifest"]["framework"] for run in performance_runs)),
        },
        "memoryBatch": {
            "planned": memory_batch["plannedRunCount"],
            "completed": memory_batch["completedRunCount"],
            "failed": memory_batch["failedRunCount"],
            "incomplete": memory_batch["incompleteRunCount"],
            "frameworkRunCounts": dict(Counter(run["manifest"]["framework"] for run in memory_runs)),
        },
        "environment": {
            "nodeVersion": EXPECTED_NODE_VERSION,
            "packageVersions": EXPECTED_PACKAGE_VERSIONS,
            "operatingSystem": environment,
        },
        "validationChecksPerformed": CHECKS_PERFORMED,
        "warnings": state.warnings,
    }

    if write_reports:
        PROCESSED_ROOT.mkdir(parents=True, exist_ok=True)
        audit_json_path = PROCESSED_ROOT / "final_data_audit.json"
        audit_text_path = PROCESSED_ROOT / "final_data_audit.txt"
        audit_json_path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
        audit_text_path.write_text(
            "\n".join(
                [
                    "Final data audit: PASSED",
                    f"Performance experiment: {PERFORMANCE_EXPERIMENT_ID}",
                    f"Performance runs: {performance_batch['completedRunCount']}/{performance_batch['plannedRunCount']} completed; {performance_batch['failedRunCount']} failed",
                    f"Memory experiment: {MEMORY_EXPERIMENT_ID}",
                    f"Memory runs: {memory_batch['completedRunCount']}/{memory_batch['plannedRunCount']} completed; {memory_batch['failedRunCount']} failed",
                    f"Benchmark Git commit: {EXPECTED_GIT_COMMIT}",
                    f"Package-lock SHA-256: {EXPECTED_PACKAGE_LOCK_SHA256}",
                    f"Raw input files: {len(all_input_files)}",
                    f"Raw input aggregate SHA-256: {audit['rawInputAggregateSha256']}",
                    f"Validation checks: {len(CHECKS_PERFORMED)}",
                    f"Warnings: {len(state.warnings)}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

    return {
        "audit": audit,
        "performanceBatch": performance_batch,
        "memoryBatch": memory_batch,
        "performanceRuns": performance_runs,
        "memoryRuns": memory_runs,
    }


def main() -> int:
    try:
        result = validate_final(write_reports=True)
    except FinalDataValidationError as error:
        print(str(error), file=sys.stderr)
        for item in error.errors:
            print(f"ERROR: {item}", file=sys.stderr)
        return 1
    except Exception as error:  # defensive CLI boundary
        print(f"Final-data validation could not complete: {error}", file=sys.stderr)
        return 1
    audit = result["audit"]
    print(
        f"Final-data validation PASSED: {audit['rawInputFileCount']} JSON files, "
        f"aggregate SHA-256 {audit['rawInputAggregateSha256']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
