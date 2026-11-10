#!/usr/bin/env python3
"""Fail-closed evidence and metric check for a Stage 2 spatial gate record."""
from __future__ import annotations
import json
import math
import sys
from pathlib import Path
from typing import Any

REQUIRED = {
    "dataIntegrity", "surfaceQuality", "routeFit", "supportContact",
    "composition", "viewEnvelope",
}
STATUSES = {"PASS", "FAIL", "NOT_RUN", "NOT_APPLICABLE"}


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def resolve_file(base: Path, value: Any) -> bool:
    if not nonempty(value):
        return False
    path = Path(value)
    if not path.is_absolute():
        path = base / path
    return path.is_file()


def check_pass_record(key: str, item: dict[str, Any], base: Path) -> list[str]:
    issues: list[str] = []
    if not nonempty(item.get("method")):
        issues.append(f"{key}: PASS requires method")
    evidence = item.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        issues.append(f"{key}: PASS requires evidence files")
    else:
        for file in evidence:
            if not resolve_file(base, file):
                issues.append(f"{key}: evidence file missing: {file}")

    if key == "dataIntegrity":
        for field in ("sourceRegister", "consumerCheck"):
            if not resolve_file(base, item.get(field)):
                issues.append(f"{key}: PASS requires existing {field} file")
    elif key == "surfaceQuality":
        if not resolve_file(base, item.get("guideOverlay")):
            issues.append(f"{key}: PASS requires an existing guideOverlay")
        sections = item.get("sections")
        if not isinstance(sections, list) or len(sections) < 2:
            issues.append(f"{key}: PASS requires at least two terrain section files")
        else:
            for file in sections:
                if not resolve_file(base, file):
                    issues.append(f"{key}: terrain section file missing: {file}")
    elif key == "routeFit":
        if not resolve_file(base, item.get("samples")):
            issues.append(f"{key}: PASS requires an existing samples file from final geometry")
        metrics = item.get("metrics", {})
        limits = item.get("limits", {})
        try:
            deviation = float(metrics["maxEdgeDeviation"])
            clearance = float(metrics["minClearance"])
            max_allowed = float(limits["maxEdgeDeviation"])
            min_allowed = float(limits["minClearance"])
            if not all(map(math.isfinite, (deviation, clearance, max_allowed, min_allowed))):
                raise ValueError
            if deviation > max_allowed or clearance < min_allowed:
                issues.append(f"{key}: measured deviation/clearance exceeds declared limits")
        except (KeyError, TypeError, ValueError):
            issues.append(f"{key}: PASS requires finite edge-deviation/clearance metrics and limits")
    elif key == "supportContact":
        if not resolve_file(base, item.get("contactReport")):
            issues.append(f"{key}: PASS requires an existing contactReport")
        expected, checked = item.get("expectedIds"), item.get("checkedIds")
        if not isinstance(expected, list) or not expected or not isinstance(checked, list) or sorted(expected) != sorted(checked):
            issues.append(f"{key}: PASS requires checkedIds to match all expectedIds")
    elif key == "composition":
        views = item.get("unlabeledViews")
        if not isinstance(views, list) or not views or any(not resolve_file(base, f) for f in views):
            issues.append(f"{key}: PASS requires existing unlabeledViews")
        criteria = item.get("criteria")
        if not isinstance(criteria, list) or not criteria:
            issues.append(f"{key}: PASS requires recorded composition criteria")
        elif any(not isinstance(c, dict) or not nonempty(c.get("criterion")) or c.get("status") not in {"PASS", "NOT_APPLICABLE"} or (c.get("status") == "NOT_APPLICABLE" and not nonempty(c.get("reason"))) for c in criteria):
            issues.append(f"{key}: composition criteria must pass or state a reason for NOT_APPLICABLE")
    elif key == "viewEnvelope":
        if not nonempty(item.get("scope")):
            issues.append(f"{key}: PASS requires declared camera scope")
        views = item.get("views")
        if not isinstance(views, list) or len(views) < 8:
            issues.append(f"{key}: PASS requires eight documented azimuth views")
        else:
            azimuths: list[float] = []
            for i, view in enumerate(views):
                if not isinstance(view, dict):
                    issues.append(f"{key}: view {i} must be an object")
                    continue
                for field in ("readability", "occlusion", "boundary"):
                    if not nonempty(view.get(field)):
                        issues.append(f"{key}: view {i} missing {field}")
                try:
                    azimuth = float(view["azimuth"])
                    if not math.isfinite(azimuth):
                        raise ValueError
                    azimuths.append(round(azimuth % 360, 3))
                except (KeyError, TypeError, ValueError):
                    issues.append(f"{key}: view {i} requires a finite azimuth")
                if not resolve_file(base, view.get("evidence")):
                    issues.append(f"{key}: view {i} evidence file missing")
            if len(set(azimuths)) < 8:
                issues.append(f"{key}: azimuth evidence must cover eight distinct directions")
    return issues


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_spatial_gate.py path/to/spatial-gate.json", file=sys.stderr)
        return 2
    record_path = Path(sys.argv[1])
    try:
        data = json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"SPATIAL_GATE_INVALID: {exc}", file=sys.stderr)
        return 2
    if not isinstance(data, dict):
        print("SPATIAL_GATE_INVALID: root must be an object", file=sys.stderr)
        return 2
    missing = REQUIRED - data.keys()
    if missing:
        print("SPATIAL_GATE_INVALID: missing checks: " + ", ".join(sorted(missing)), file=sys.stderr)
        return 2

    failures: list[str] = []
    pending: list[str] = []
    incomplete: list[str] = []
    base = record_path.resolve().parent
    for key in sorted(REQUIRED):
        item = data[key]
        if not isinstance(item, dict) or item.get("status") not in STATUSES:
            incomplete.append(f"{key}: invalid record/status")
            continue
        status = item["status"]
        if status == "NOT_APPLICABLE":
            if not nonempty(item.get("reason")):
                incomplete.append(f"{key}: NOT_APPLICABLE requires reason")
            continue
        if status == "NOT_RUN":
            pending.append(key)
            if not nonempty(item.get("reason")):
                incomplete.append(f"{key}: NOT_RUN requires reason")
            continue
        if status == "FAIL":
            failures.append(key)
            if not nonempty(item.get("method")):
                incomplete.append(f"{key}: FAIL requires method")
            evidence = item.get("evidence")
            if not isinstance(evidence, list) or not evidence:
                incomplete.append(f"{key}: FAIL requires evidence files")
            else:
                for file in evidence:
                    if not resolve_file(base, file):
                        incomplete.append(f"{key}: evidence file missing: {file}")
        else:
            incomplete.extend(check_pass_record(key, item, base))

    if failures or pending or incomplete:
        print("SPATIAL_GATE_BLOCKED")
        if failures:
            print("FAIL: " + ", ".join(failures))
        if pending:
            print("NOT_RUN: " + ", ".join(pending))
        for issue in incomplete:
            print(f"- {issue}")
        return 1
    print("SPATIAL_GATE_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
