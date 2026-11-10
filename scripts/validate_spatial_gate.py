#!/usr/bin/env python3
"""Fail-closed evidence and metric check for a Stage 2 spatial gate record."""
from __future__ import annotations
import json
import hashlib
import math
import sys
from pathlib import Path
from typing import Any

REQUIRED = {
    "dataIntegrity", "surfaceQuality", "routeFit", "supportContact",
    "composition", "viewEnvelope", "proxyStage",
}
STATUSES = {"PASS", "FAIL", "NOT_RUN", "NOT_APPLICABLE"}
COMPOSITION_DIMENSIONS = {
    "focus-and-hierarchy", "environment-and-depth", "negative-space-and-crop",
    "critical-relations", "scale-and-occupancy", "task-specific",
}


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def resolve_file(base: Path, value: Any) -> bool:
    if not nonempty(value):
        return False
    path = Path(value)
    if not path.is_absolute():
        path = base / path
    return path.is_file()


def load_json(base: Path, value: Any) -> dict[str, Any] | None:
    if not resolve_file(base, value):
        return None
    path = Path(value)
    if not path.is_absolute():
        path = base / path
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return result if isinstance(result, dict) else None


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
        register = load_json(base, item.get("sourceRegister"))
        drivers = register.get("sharedDrivers", []) if register else []
        if drivers:
            issues.extend(check_shared_driver_consumers(item, base, register, drivers))
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
        if item.get("viewMode") != "neutral-proxy":
            issues.append(f"{key}: PASS must review the neutral proxy build, not a detailed/final build")
        views = item.get("unlabeledViews")
        if not isinstance(views, list) or not views or any(not resolve_file(base, f) for f in views):
            issues.append(f"{key}: PASS requires existing unlabeledViews")
        criteria = item.get("criteria")
        if not isinstance(criteria, list) or not criteria:
            issues.append(f"{key}: PASS requires recorded composition criteria")
        else:
            found: set[str] = set()
            for i, criterion in enumerate(criteria):
                if not isinstance(criterion, dict):
                    issues.append(f"{key}: criterion {i} must be an object")
                    continue
                dimension = criterion.get("dimension")
                if dimension not in COMPOSITION_DIMENSIONS:
                    issues.append(f"{key}: criterion {i} needs a recognized dimension")
                else:
                    if dimension in found:
                        issues.append(f"{key}: duplicate criterion dimension {dimension}")
                    found.add(dimension)
                if not nonempty(criterion.get("criterion")):
                    issues.append(f"{key}: criterion {i} needs a scene-specific observation")
                status = criterion.get("status")
                if status not in {"PASS", "NOT_APPLICABLE"}:
                    issues.append(f"{key}: every criterion must PASS or be explicitly NOT_APPLICABLE")
                if status == "NOT_APPLICABLE" and not nonempty(criterion.get("reason")):
                    issues.append(f"{key}: NOT_APPLICABLE criterion {i} requires a reason")
                if status == "PASS":
                    evidence = criterion.get("evidence")
                    if not isinstance(evidence, list) or not evidence or any(not resolve_file(base, f) for f in evidence):
                        issues.append(f"{key}: PASS criterion {i} requires existing dimension-specific evidence files")
            missing_dimensions = COMPOSITION_DIMENSIONS - found
            if missing_dimensions:
                issues.append(f"{key}: missing required dimensions: " + ", ".join(sorted(missing_dimensions)))
    elif key == "proxyStage":
        snapshot_path = item.get("sourceSnapshot")
        snapshot = Path(snapshot_path) if nonempty(snapshot_path) else None
        if snapshot is not None and not snapshot.is_absolute():
            snapshot = base / snapshot
        if snapshot is None or not snapshot.is_file():
            issues.append(f"{key}: PASS requires an existing frozen sourceSnapshot")
            snapshot_hash = None
        else:
            snapshot_hash = hashlib.sha256(snapshot.read_bytes()).hexdigest()
            if item.get("sourceSha256") != snapshot_hash:
                issues.append(f"{key}: sourceSnapshot SHA-256 mismatch")
        if not nonempty(item.get("buildId")):
            issues.append(f"{key}: PASS requires a stable buildId")
        inventory = load_json(base, item.get("inventory"))
        if inventory is None:
            issues.append(f"{key}: PASS requires an existing valid inventory JSON")
        else:
            if inventory.get("stage") != "spatial-proxy":
                issues.append(f"{key}: inventory stage must be spatial-proxy")
            if inventory.get("buildId") != item.get("buildId"):
                issues.append(f"{key}: buildId must match the inventory")
            if inventory.get("sourceSha256") != item.get("sourceSha256") or (snapshot_hash and inventory.get("sourceSha256") != snapshot_hash):
                issues.append(f"{key}: inventory must reference the frozen sourceSnapshot hash")
            if inventory.get("renderMode") != "neutral":
                issues.append(f"{key}: renderMode must be neutral")
            if inventory.get("formalAssetsStarted") is not False:
                issues.append(f"{key}: formalAssetsStarted must be false at proxy release")
            for field in ("formalAssetCount", "detailedMaterialCount", "detailGeneratorCount"):
                value = inventory.get(field)
                if type(value) is not int or value != 0:
                    issues.append(f"{key}: {field} must be 0 at proxy release")
            components = inventory.get("components")
            if not isinstance(components, list) or not components:
                issues.append(f"{key}: inventory requires all major spatial components")
            else:
                ids: set[str] = set()
                for index, component in enumerate(components):
                    if not isinstance(component, dict) or not nonempty(component.get("id")) or component.get("role") != "proxy":
                        issues.append(f"{key}: component {index} must have a stable id and role=proxy")
                        continue
                    if component["id"] in ids:
                        issues.append(f"{key}: duplicate proxy component id {component['id']}")
                    ids.add(component["id"])
        review = load_json(base, item.get("reviewRecord"))
        if review is None:
            issues.append(f"{key}: PASS requires an existing proxy reviewRecord JSON")
        else:
            if review.get("result") != "PASS" or not nonempty(review.get("reviewer")):
                issues.append(f"{key}: reviewRecord requires result=PASS and a named reviewer")
            if review.get("buildId") != item.get("buildId"):
                issues.append(f"{key}: reviewRecord buildId must match the released proxy build")
            if review.get("reviewedSourceSha256") != item.get("sourceSha256") or (snapshot_hash and review.get("reviewedSourceSha256") != snapshot_hash):
                issues.append(f"{key}: reviewRecord must identify the reviewed sourceSnapshot hash")
            if review.get("formalAssetsStarted") is not False:
                issues.append(f"{key}: review must record formalAssetsStarted=false")
            reviewed = review.get("reviewedSampleIds")
            if not isinstance(reviewed, list) or not reviewed or any(not nonempty(sample_id) for sample_id in reviewed) or len(set(reviewed)) != len(reviewed):
                issues.append(f"{key}: reviewRecord requires unique reviewedSampleIds")
    elif key == "viewEnvelope":
        if not nonempty(item.get("buildId")):
            issues.append(f"{key}: PASS requires a buildId tied to the captured spatial proxy")
        if not nonempty(item.get("scope")):
            issues.append(f"{key}: PASS requires declared camera scope")
        contract_path = item.get("contract")
        contract = load_json(base, contract_path)
        if contract is None:
            issues.append(f"{key}: PASS requires an existing valid camera contract JSON")
            contract = {}
        if contract.get("mode") != "interactive-orbit":
            issues.append(f"{key}: viewEnvelope PASS requires interactive-orbit; fixed director cameras use NOT_APPLICABLE")
        bounds = contract.get("bounds", {})
        for field in ("azimuthDeg", "polarDeg", "distance"):
            span = bounds.get(field) if isinstance(bounds, dict) else None
            if not isinstance(span, list) or len(span) != 2 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in span) or span[0] > span[1]:
                issues.append(f"{key}: camera contract requires finite ordered bounds.{field}")
        request = contract.get("request")
        requested_bounds = request.get("bounds") if isinstance(request, dict) else None
        if not isinstance(request, dict) or not nonempty(request.get("source")) or request.get("mode") != contract.get("mode"):
            issues.append(f"{key}: camera contract must trace its requested mode to a brief/source")
        for field in ("azimuthDeg", "polarDeg", "distance"):
            requested = requested_bounds.get(field) if isinstance(requested_bounds, dict) else None
            actual = bounds.get(field) if isinstance(bounds, dict) else None
            if not isinstance(requested, list) or len(requested) != 2 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in requested) or requested[0] > requested[1]:
                issues.append(f"{key}: request.bounds.{field} must be finite and ordered")
            elif isinstance(actual, list) and len(actual) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in actual) and actual[0] <= actual[1] and (actual[0] > requested[0] or actual[1] < requested[1]):
                issues.append(f"{key}: implemented bounds.{field} narrows the requested camera scope")
        required_samples = contract.get("requiredSamples")
        required_by_id: dict[str, dict[str, Any]] = {}
        if not isinstance(required_samples, list) or not required_samples:
            issues.append(f"{key}: camera contract requires explicit requiredSamples")
        else:
            for i, sample in enumerate(required_samples):
                if not isinstance(sample, dict) or not nonempty(sample.get("id")):
                    issues.append(f"{key}: requiredSamples[{i}] needs a stable id")
                    continue
                sid = sample["id"]
                if sid in required_by_id:
                    issues.append(f"{key}: duplicate required camera sample id {sid}")
                required_by_id[sid] = sample
                for field in ("azimuthDeg", "polarDeg", "distance"):
                    value = sample.get(field)
                    span = bounds.get(field) if isinstance(bounds, dict) else None
                    if not isinstance(value, (int, float)) or not math.isfinite(value):
                        issues.append(f"{key}: required sample {sid} needs finite {field}")
                    elif isinstance(span, list) and len(span) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in span) and span[0] <= span[1] and not (span[0] <= value <= span[1]):
                        issues.append(f"{key}: required sample {sid} falls outside bounds.{field}")
            valid_samples = [s for s in required_by_id.values() if all(isinstance(s.get(k), (int, float)) and math.isfinite(s[k]) for k in ("azimuthDeg", "polarDeg", "distance"))]
            az_span = bounds.get("azimuthDeg") if isinstance(bounds, dict) else None
            if isinstance(az_span, list) and len(az_span) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in az_span) and az_span[0] < az_span[1]:
                span = az_span[1] - az_span[0]
                sectors = {min(7, max(0, int(((((s["azimuthDeg"] - az_span[0]) % 360) if span >= 359.5 else (s["azimuthDeg"] - az_span[0])) / span) * 8))) for s in valid_samples if az_span[0] <= s["azimuthDeg"] <= az_span[1] or span >= 359.5}
                if len(sectors) < 8:
                    issues.append(f"{key}: requiredSamples must cover eight sectors across requested azimuth bounds")
            polar_span = bounds.get("polarDeg") if isinstance(bounds, dict) else None
            if isinstance(polar_span, list) and len(polar_span) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in polar_span) and polar_span[1] - polar_span[0] > 0.5:
                for endpoint in polar_span:
                    azs = {round(s["azimuthDeg"] % 360, 3) for s in valid_samples if abs(s["polarDeg"] - endpoint) <= 0.5}
                    if len(azs) < 4:
                        issues.append(f"{key}: requiredSamples must cover each requested polar endpoint at four azimuths")
            distance_span = bounds.get("distance") if isinstance(bounds, dict) else None
            if isinstance(distance_span, list) and len(distance_span) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in distance_span) and distance_span[1] - distance_span[0] > 0.02:
                for endpoint in distance_span:
                    azs = {round(s["azimuthDeg"] % 360, 3) for s in valid_samples if abs(s["distance"] - endpoint) <= 0.02}
                    if len(azs) < 2:
                        issues.append(f"{key}: requiredSamples must cover each requested distance endpoint at two azimuths")
        views = item.get("views")
        if not isinstance(views, list) or len(views) < 8:
            issues.append(f"{key}: PASS requires eight documented azimuth views")
        else:
            azimuths: list[float] = []
            actual_by_id: dict[str, dict[str, Any]] = {}
            for i, view in enumerate(views):
                if not isinstance(view, dict):
                    issues.append(f"{key}: view {i} must be an object")
                    continue
                for field in ("sampleId", "readability", "occlusion", "boundary"):
                    if not nonempty(view.get(field)):
                        issues.append(f"{key}: view {i} missing {field}")
                try:
                    azimuth = float(view["azimuthDeg"])
                    polar = float(view["polarDeg"])
                    distance = float(view["distance"])
                    if not all(map(math.isfinite, (azimuth, polar, distance))):
                        raise ValueError
                    azimuths.append(round(azimuth % 360, 3))
                except (KeyError, TypeError, ValueError):
                    issues.append(f"{key}: view {i} requires finite azimuthDeg, polarDeg, and distance")
                    continue
                sid = view.get("sampleId")
                if isinstance(sid, str):
                    if sid in actual_by_id:
                        issues.append(f"{key}: duplicate captured sampleId {sid}")
                    actual_by_id[sid] = view
                if not resolve_file(base, view.get("evidence")):
                    issues.append(f"{key}: view {i} evidence file missing")
                else:
                    image_path = Path(view["evidence"])
                    if not image_path.is_absolute():
                        image_path = base / image_path
                    actual_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
                    if view.get("sha256") != actual_hash:
                        issues.append(f"{key}: view {i} evidence sha256 mismatch")
            if len(set(azimuths)) < 8:
                issues.append(f"{key}: azimuth evidence must cover eight distinct directions")
            for sid, expected in required_by_id.items():
                actual = actual_by_id.get(sid)
                if actual is None:
                    issues.append(f"{key}: required camera sample missing: {sid}")
                    continue
                for field in ("azimuthDeg", "polarDeg", "distance"):
                    try:
                        if abs(float(actual[field]) - float(expected[field])) > (0.5 if field != "distance" else 0.02):
                            issues.append(f"{key}: captured sample {sid} does not match contract {field}")
                    except (KeyError, TypeError, ValueError):
                        issues.append(f"{key}: captured sample {sid} missing contract coordinate {field}")
    return issues


def check_shared_driver_consumers(item: dict[str, Any], base: Path, register: dict[str, Any], drivers: Any) -> list[str]:
    """Require a before/after run for every declared consumer of each shared driver."""
    issues: list[str] = []
    check = load_json(base, item.get("consumerCheck"))
    if check is None:
        return ["dataIntegrity: sharedDrivers require consumerCheck to be valid JSON"]
    register_path = Path(item["sourceRegister"])
    if not register_path.is_absolute():
        register_path = base / register_path
    try:
        register_hash = hashlib.sha256(register_path.read_bytes()).hexdigest()
    except OSError:
        register_hash = ""
    if check.get("sourceRegisterSha256") != register_hash:
        issues.append("dataIntegrity: consumerCheck sourceRegisterSha256 must match the current register")
    render = check.get("renderContract")
    if not isinstance(render, dict) or render.get("seed") is None or not nonempty(render.get("camera")) or render.get("otherInputsLocked") is not True:
        issues.append("dataIntegrity: renderContract must freeze seed, camera, resolution, and other inputs")
    elif (
        not isinstance(render.get("resolution"), list)
        or len(render["resolution"]) != 2
        or any(type(value) is not int or value <= 0 for value in render["resolution"])
    ):
        issues.append("dataIntegrity: renderContract resolution must be two positive integers")

    declared: dict[str, set[str]] = {}
    for driver in drivers:
        if not isinstance(driver, dict) or not isinstance(driver.get("id"), str):
            issues.append("dataIntegrity: sharedDrivers contains an invalid driver record")
            continue
        consumers = driver.get("consumers")
        if not isinstance(consumers, list):
            issues.append(f"dataIntegrity: {driver['id']} consumers must be a list")
            continue
        declared[driver["id"]] = {c["id"] for c in consumers if isinstance(c, dict) and isinstance(c.get("id"), str)}

    checks = check.get("driverChecks")
    if not isinstance(checks, list):
        return issues + ["dataIntegrity: consumerCheck.driverChecks must be a list"]
    actual: dict[str, dict[str, Any]] = {}
    for index, driver_check in enumerate(checks):
        if not isinstance(driver_check, dict) or not isinstance(driver_check.get("driverId"), str):
            issues.append(f"dataIntegrity: driverCheck {index} requires driverId")
            continue
        driver_id = driver_check["driverId"]
        if driver_id in actual:
            issues.append(f"dataIntegrity: duplicate driverCheck {driver_id}")
        actual[driver_id] = driver_check
        if driver_id not in declared:
            issues.append(f"dataIntegrity: consumerCheck contains unregistered driver {driver_id}")
            continue
        change = driver_check.get("inputChange")
        if not isinstance(change, dict) or "before" not in change or "after" not in change or change["before"] == change["after"] or not nonempty(change.get("reason")):
            issues.append(f"dataIntegrity: {driver_id} inputChange before and after must differ and include a reason")
        consumers = driver_check.get("consumers")
        if not isinstance(consumers, list):
            issues.append(f"dataIntegrity: {driver_id} consumers must be a list")
            continue
        consumer_results: dict[str, dict[str, Any]] = {}
        for result in consumers:
            if not isinstance(result, dict) or not isinstance(result.get("id"), str):
                issues.append(f"dataIntegrity: {driver_id} has a consumer result without id")
                continue
            consumer_id = result["id"]
            if consumer_id in consumer_results:
                issues.append(f"dataIntegrity: {driver_id} duplicate consumer result {consumer_id}")
            consumer_results[consumer_id] = result
        if set(consumer_results) != declared[driver_id]:
            issues.append(f"dataIntegrity: {driver_id} consumers do not match the register")
        for consumer_id, result in consumer_results.items():
            evidence = result.get("evidence")
            if not isinstance(evidence, list) or len(evidence) != 2 or evidence[0] == evidence[1]:
                issues.append(f"dataIntegrity: {driver_id}.{consumer_id} requires distinct baseline/perturbed evidence files")
                continue
            hashes: list[str] = []
            for path_value in evidence:
                path = Path(path_value) if nonempty(path_value) else None
                if path is not None and not path.is_absolute():
                    path = base / path
                if path is None or not path.is_file():
                    issues.append(f"dataIntegrity: {driver_id}.{consumer_id} evidence file missing")
                    hashes.append("")
                else:
                    hashes.append(hashlib.sha256(path.read_bytes()).hexdigest())
            if result.get("baselineOutputSha256") != hashes[0] or result.get("perturbedOutputSha256") != hashes[1]:
                issues.append(f"dataIntegrity: {driver_id}.{consumer_id} output hashes must match evidence files")
            if hashes[0] and hashes[0] == hashes[1]:
                issues.append(f"dataIntegrity: {driver_id}.{consumer_id} output hashes must differ after perturbation")
            if not nonempty(result.get("observedEffect")):
                issues.append(f"dataIntegrity: {driver_id}.{consumer_id} requires observedEffect")
    if set(actual) != set(declared):
        issues.append("dataIntegrity: driverChecks do not match all sharedDrivers in the register")
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
            if key == "proxyStage":
                incomplete.append("proxyStage: cannot be NOT_APPLICABLE; inherit and verify a current proxy snapshot instead")
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

    proxy = data.get("proxyStage")
    composition = data.get("composition")
    if isinstance(proxy, dict) and proxy.get("status") == "PASS" and isinstance(composition, dict) and composition.get("status") == "PASS":
        if composition.get("buildId") != proxy.get("buildId"):
            incomplete.append("composition: PASS must reference the same proxy buildId as proxyStage")
    view_envelope = data.get("viewEnvelope")
    if isinstance(proxy, dict) and proxy.get("status") == "PASS" and isinstance(view_envelope, dict) and view_envelope.get("status") == "PASS":
        if view_envelope.get("buildId") != proxy.get("buildId"):
            incomplete.append("viewEnvelope: PASS must reference the same proxy buildId as proxyStage")
        review = load_json(base, proxy.get("reviewRecord"))
        captured_ids = {view.get("sampleId") for view in view_envelope.get("views", []) if isinstance(view, dict) and isinstance(view.get("sampleId"), str)}
        reviewed_ids = set(review.get("reviewedSampleIds", [])) if review and isinstance(review.get("reviewedSampleIds"), list) else set()
        if captured_ids != reviewed_ids:
            incomplete.append("proxyStage: reviewRecord reviewedSampleIds must match all captured viewEnvelope samples")

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
