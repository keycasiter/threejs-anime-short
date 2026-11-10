#!/usr/bin/env python3
"""Validate a scope-aware Three.js production handoff manifest.

This checks stage completeness, artifact hashes, handoff provenance, and the
existing specialist validators. It does not judge visual quality by itself.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import struct
from pathlib import Path
from typing import Any

PIPELINE = (
    "direction",
    "visualAnalysis",
    "runtimePreflight",
    "spatialProxy",
    "middleForms",
    "detailDistribution",
    "lookdev",
    "cameraMotion",
    "runtime",
    "visualReview",
    "delivery",
)
MODE_STAGES = {
    "mechanism-test": ("mechanismTest",),
    "analysis-only": ("direction", "visualAnalysis"),
    "spatial-handoff": PIPELINE[:4],
    "full-production": PIPELINE,
}
ALL_STAGES = set(PIPELINE) | {"mechanismTest"}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REVIEW_DIMENSIONS = {
    "composition", "spatial-depth", "middle-form", "detail-distribution",
    "material-lighting", "orbit-coverage", "interaction",
}
RENDERABLE_ROLES = {"solid", "surface", "path"}
ASSET_INTEGRITY_CHECKS = (
    "silhouette", "volume-transition", "connections-support",
    "material-response", "spatial-relation", "detail-scale",
)
ASSET_CHECKS_BY_PRIORITY = {priority: ASSET_INTEGRITY_CHECKS for priority in ("focal", "supporting", "ambient")}
PROTOTYPE_VIEW_ROLES = {"primary", "oblique", "side", "back", "top", "underside", "joint", "context"}
FEATURE_VIEW_REQUIREMENTS = {
    "silhouette": ({"primary"}, {"oblique", "side", "back", "top", "underside"}),
    "proportion": ({"primary"}, {"oblique", "side", "back", "top", "underside"}),
    "volume": ({"primary"}, {"oblique", "side", "back", "top", "underside"}),
    "connection": ({"joint"}, {"oblique", "side", "back", "underside"}),
    "spatial-relation": ({"context"}, {"oblique", "side", "back"}),
}


def _resolve(base: Path, value: Any) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    path = Path(value)
    if path.is_absolute():
        return None
    resolved = (base / path).resolve()
    try:
        resolved.relative_to(base.resolve())
    except ValueError:
        return None
    return resolved if resolved.is_file() else None


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _check_file_record(base: Path, record: Any, label: str, issues: list[str]) -> tuple[str, str] | None:
    if not isinstance(record, dict):
        issues.append(f"{label}: must contain path and sha256")
        return None
    relative = record.get("path")
    digest = record.get("sha256")
    path = _resolve(base, relative)
    if path is None:
        issues.append(f"{label}: missing, absolute, or out-of-project file: {relative}")
        return None
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        issues.append(f"{label}: sha256 must be 64 lowercase hexadecimal characters")
        return None
    actual = _hash(path)
    if digest != actual:
        issues.append(f"{label}: SHA-256 mismatch for {relative}")
        return None
    return str(relative), digest


def _check_capture_png(base: Path, path: str, label: str, issues: list[str]) -> None:
    image_path = _resolve(base, path)
    try:
        header = image_path.read_bytes()[:24] if image_path else b""
    except OSError:
        header = b""
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        issues.append(f"{label} must be a real PNG capture with an IHDR header")
        return
    width, height = struct.unpack(">II", header[16:24])
    if max(width, height) < 640 or min(width, height) < 320:
        issues.append(f"{label} must be at least 640px on its long edge and 320px on its short edge")


def _run_specialist(script_name: str, target: Path, base: Path, label: str, issues: list[str]) -> None:
    script = Path(__file__).resolve().with_name(script_name)
    try:
        result = subprocess.run(
            [sys.executable, str(script), str(target)], cwd=base,
            capture_output=True, text=True, check=False,
        )
    except OSError as exc:
        issues.append(f"{label}: could not run {script_name}: {exc}")
        return
    if result.returncode != 0:
        detail = (result.stdout + result.stderr).strip().replace("\n", " | ")
        issues.append(f"{label}: {script_name} blocked ({detail})")


def _validate_runtime_report(base: Path, record: Any, build_id: str, camera_contract_path: Any, issues: list[str]) -> set[str]:
    if not isinstance(record, str) or not record.strip():
        issues.append("runtime: full-production requires runtimeReport path")
        return set()
    path = _resolve(base, record)
    report = _load_json(path) if path else None
    if report is None:
        issues.append("runtime: runtimeReport must be an existing JSON file")
        return set()
    if report.get("status") != "PASS" or report.get("buildId") != build_id:
        issues.append("runtime: report must PASS and match the current buildId")
    for key in ("threeVersion", "browser"):
        if not isinstance(report.get(key), str) or not report[key].strip():
            issues.append(f"runtime: report requires {key}")
    for key in ("consoleErrors", "failedRequests"):
        value = report.get(key)
        if not isinstance(value, list) or value:
            issues.append(f"runtime: {key} must be an empty list for PASS")
    captures = report.get("captures")
    capture_ids: set[str] = set()
    if not isinstance(captures, list) or not captures:
        issues.append("runtime: report requires captured view evidence")
        return capture_ids
    contract_file = _resolve(base, camera_contract_path)
    contract = _load_json(contract_file) if contract_file else None
    contract_samples: dict[str, dict[str, Any]] = {}
    if contract is None:
        issues.append("runtime: cameraMotion stage must provide an existing camera contract JSON")
    else:
        if contract.get("mode") not in {"interactive-orbit", "director-camera"}:
            issues.append("runtime: camera contract mode must be interactive-orbit or director-camera")
        samples = contract.get("requiredSamples")
        if not isinstance(samples, list) or not samples:
            issues.append("runtime: camera contract requires requiredSamples")
        else:
            for sample_index, sample in enumerate(samples):
                if not isinstance(sample, dict) or not isinstance(sample.get("id"), str) or not sample["id"].strip():
                    issues.append(f"runtime: camera contract requiredSamples[{sample_index}] needs a stable id")
                    continue
                if sample["id"] in contract_samples:
                    issues.append(f"runtime: duplicate camera sample id {sample['id']}")
                contract_samples[sample["id"]] = sample
        if contract.get("mode") == "interactive-orbit":
            bounds = contract.get("bounds")
            normalized_bounds: dict[str, tuple[float, float]] = {}
            if not isinstance(bounds, dict):
                issues.append("runtime: interactive-orbit contract requires bounds")
            else:
                for field in ("azimuthDeg", "polarDeg", "distance"):
                    span = bounds.get(field)
                    if not isinstance(span, list) or len(span) != 2 or any(not isinstance(v, (int, float)) for v in span) or span[0] > span[1]:
                        issues.append(f"runtime: camera contract requires ordered bounds.{field}")
                    else:
                        normalized_bounds[field] = (float(span[0]), float(span[1]))
            if "azimuthDeg" in normalized_bounds and normalized_bounds["azimuthDeg"][1] - normalized_bounds["azimuthDeg"][0] >= 359.9:
                _check_full_orbit_matrix(contract_samples, normalized_bounds, issues)
    for index, capture in enumerate(captures):
        if not isinstance(capture, dict) or not isinstance(capture.get("id"), str) or not capture["id"].strip():
            issues.append(f"runtime: captures[{index}] requires stable id")
            continue
        sample_id = capture["id"]
        if sample_id in capture_ids:
            issues.append(f"runtime: duplicate capture id {sample_id}")
        capture_ids.add(sample_id)
        _check_file_record(base, capture, f"runtime capture {sample_id}", issues)
        sample = contract_samples.get(sample_id)
        if sample is None:
            issues.append(f"runtime: capture {sample_id} is absent from the final camera contract")
        else:
            for coordinate in ("azimuthDeg", "polarDeg", "distance"):
                if coordinate in sample and capture.get(coordinate) != sample[coordinate]:
                    issues.append(f"runtime: capture {sample_id} {coordinate} differs from camera contract")
    if capture_ids != set(contract_samples):
        issues.append("runtime: capture IDs must cover every final camera contract requiredSample exactly")
    return capture_ids


def _validate_runtime_preflight(base: Path, stage: dict[str, Any], issues: list[str]) -> None:
    record = stage.get("preflightReport")
    if not isinstance(record, str) or not record.strip():
        issues.append("runtimePreflight: requires preflightReport path")
        return
    path = _resolve(base, record)
    report = _load_json(path) if path else None
    if report is None:
        issues.append("runtimePreflight: preflightReport must be an existing JSON file")
        return
    if report.get("status") != "PASS" or report.get("buildId") != stage.get("buildId"):
        issues.append("runtimePreflight: report must PASS and match its stage buildId")
    for field in ("threeVersion", "browser", "renderer", "dependencyStrategy"):
        if not isinstance(report.get(field), str) or not report[field].strip():
            issues.append(f"runtimePreflight: report requires {field}")
    if report.get("renderer") not in {"WebGL", "WebGL2", "WebGPU"}:
        issues.append("runtimePreflight: renderer must name an initialized Three.js rendering backend")
    for field in ("consoleErrors", "failedRequests"):
        if not isinstance(report.get(field), list) or report[field]:
            issues.append(f"runtimePreflight: {field} must be empty for PASS")
    capture = report.get("capture")
    capture_ref = _check_file_record(base, capture, "runtimePreflight capture", issues)
    report_ref = _check_file_record(base, {"path": record, "sha256": _hash(path) if path else ""}, "runtimePreflight report", issues)
    evidence = {
        (item.get("path"), item.get("sha256"))
        for item in stage.get("evidence", []) if isinstance(item, dict)
    }
    if report_ref and report_ref not in evidence:
        issues.append("runtimePreflight evidence must include preflightReport with its SHA-256")
    if capture_ref and capture_ref not in evidence:
        issues.append("runtimePreflight evidence must include the rendered WebGL capture with its SHA-256")


def _check_full_orbit_matrix(samples: dict[str, dict[str, Any]], bounds: dict[str, tuple[float, float]], issues: list[str]) -> None:
    if len(samples) < 20:
        issues.append("runtime: full 360-degree camera contract requires at least 20 envelope samples")
        return
    for sample_id, sample in samples.items():
        for field in ("azimuthDeg", "polarDeg", "distance"):
            value = sample.get(field)
            if not isinstance(value, (int, float)):
                issues.append(f"runtime: orbit sample {sample_id} requires {field}")
                break
            lower, upper = bounds[field]
            if field != "azimuthDeg" and not lower <= value <= upper:
                issues.append(f"runtime: orbit sample {sample_id} lies outside bounds.{field}")

    def angle(value: float) -> float:
        return value % 360.0

    pair_counts: dict[tuple[float, float], list[dict[str, Any]]] = {}
    for sample in samples.values():
        polar, distance = sample.get("polarDeg"), sample.get("distance")
        if isinstance(polar, (int, float)) and isinstance(distance, (int, float)):
            pair_counts.setdefault((round(float(polar), 3), round(float(distance), 3)), []).append(sample)
    if not pair_counts:
        return
    representative, horizontal = max(pair_counts.items(), key=lambda item: len(item[1]))
    if len(horizontal) < 8:
        issues.append("runtime: full orbit matrix needs eight horizontal azimuth samples at one representative pitch/distance")
        return
    azimuths = sorted(angle(float(sample["azimuthDeg"])) for sample in horizontal)
    if len({round(value, 2) for value in azimuths}) < 8:
        issues.append("runtime: horizontal orbit samples must cover eight distinct azimuths")
    gaps = [((azimuths[(i + 1) % len(azimuths)] - azimuths[i]) % 360.0) for i in range(len(azimuths))]
    if len(azimuths) == 8 and any(abs(gap - 45.0) > 2.0 for gap in gaps):
        issues.append("runtime: horizontal orbit samples must span the circle at roughly 45-degree intervals")

    min_polar, max_polar = bounds["polarDeg"]
    representative_distance = representative[1]
    for cardinal in (0.0, 90.0, 180.0, 270.0):
        for endpoint in (min_polar, max_polar):
            if not any(
                abs(((angle(float(s.get("azimuthDeg", 999))) - cardinal + 180.0) % 360.0) - 180.0) <= 1.0
                and abs(float(s.get("polarDeg", 999)) - endpoint) <= 0.01
                and abs(float(s.get("distance", 999)) - representative_distance) <= 0.01
                for s in samples.values()
            ):
                issues.append(f"runtime: orbit matrix missing pitch endpoint {endpoint:g} at azimuth {cardinal:g}")
    min_distance, max_distance = bounds["distance"]
    representative_polar = representative[0]
    for cardinal in (0.0, 180.0):
        for endpoint in (min_distance, max_distance):
            if not any(
                abs(((angle(float(s.get("azimuthDeg", 999))) - cardinal + 180.0) % 360.0) - 180.0) <= 1.0
                and abs(float(s.get("polarDeg", 999)) - representative_polar) <= 0.01
                and abs(float(s.get("distance", 999)) - endpoint) <= 0.01
                for s in samples.values()
            ):
                issues.append(f"runtime: orbit matrix missing distance endpoint {endpoint:g} at azimuth {cardinal:g}")


def _validate_visual_review(base: Path, record: Any, build_id: str, capture_ids: set[str], camera_mode: str, issues: list[str]) -> None:
    if not isinstance(record, str) or not record.strip():
        issues.append("visualReview: full-production requires visualReviewReport path")
        return
    path = _resolve(base, record)
    report = _load_json(path) if path else None
    if report is None:
        issues.append("visualReview: visualReviewReport must be an existing JSON file")
        return
    if report.get("status") != "PASS" or report.get("buildId") != build_id:
        issues.append("visualReview: report must PASS and match the current buildId")
    if not isinstance(report.get("reviewer"), str) or not report["reviewer"].strip():
        issues.append("visualReview: report requires a reviewer")
    reviewed = report.get("reviewedSampleIds")
    if not isinstance(reviewed, list) or set(reviewed) != capture_ids or len(reviewed) != len(capture_ids):
        issues.append("visualReview: reviewedSampleIds must match every runtime capture exactly")
    checks = report.get("checks")
    found: set[str] = set()
    if not isinstance(checks, list):
        issues.append("visualReview: checks must list the required visual dimensions")
    else:
        for i, check in enumerate(checks):
            if not isinstance(check, dict):
                issues.append(f"visualReview: checks[{i}] must be an object")
                continue
            dimension = check.get("dimension")
            if dimension not in REVIEW_DIMENSIONS:
                issues.append(f"visualReview: checks[{i}] has unknown dimension")
                continue
            if dimension in found:
                issues.append(f"visualReview: duplicate dimension {dimension}")
            found.add(dimension)
            status = check.get("status")
            if status not in {"PASS", "NOT_APPLICABLE"}:
                issues.append(f"visualReview: {dimension} must PASS or be explicitly NOT_APPLICABLE")
            if status == "PASS" and (not isinstance(check.get("observation"), str) or not check["observation"].strip()):
                issues.append(f"visualReview: {dimension} PASS requires a concrete observation")
            if status == "NOT_APPLICABLE" and (dimension not in {"orbit-coverage", "interaction"} or camera_mode == "interactive-orbit" or not isinstance(check.get("reason"), str) or not check["reason"].strip()):
                issues.append(f"visualReview: {dimension} NOT_APPLICABLE requires a fixed-camera reason")
            if camera_mode == "interactive-orbit" and dimension in {"orbit-coverage", "interaction"} and status != "PASS":
                issues.append(f"visualReview: interactive-orbit requires {dimension} PASS")
    missing = REVIEW_DIMENSIONS - found
    if missing:
        issues.append("visualReview: missing checks: " + ", ".join(sorted(missing)))


def validate_asset_ledger(base: Path, scene_register_path: Any, asset_ledger_path: Any, visual_build_map_path: Any, stage: Any, issues: list[str]) -> set[str]:
    """Require every renderable registered object/route to belong to one reviewed asset family."""
    register_file = _resolve(base, scene_register_path)
    ledger_file = _resolve(base, asset_ledger_path)
    map_file = _resolve(base, visual_build_map_path)
    if register_file is None:
        issues.append("assetLedger: sceneRegisterPath must reference an existing JSON file")
        return set()
    if ledger_file is None:
        issues.append("assetLedgerPath must reference an existing project JSON file")
        return set()
    if map_file is None:
        issues.append("visualBuildMapPath must reference an existing project JSON file")
        return set()
    ledger_digest = _hash(ledger_file)
    evidence = stage.get("evidence", []) if isinstance(stage, dict) else []
    if not any(isinstance(item, dict) and item.get("path") == asset_ledger_path and item.get("sha256") == ledger_digest for item in evidence):
        issues.append("middleForms evidence must include assetLedgerPath with its SHA-256")
    register, ledger, build_map = _load_json(register_file), _load_json(ledger_file), _load_json(map_file)
    if register is None or ledger is None or build_map is None:
        issues.append("assetLedger, visualBuildMap, and sceneRegister must be readable JSON objects")
        return set()
    renderables: set[tuple[str, str]] = set()
    for obj in register.get("objects", []):
        if isinstance(obj, dict) and obj.get("geometryRole") in RENDERABLE_ROLES and isinstance(obj.get("id"), str):
            renderables.add(("object", obj["id"]))
    for route in register.get("routes", []):
        if isinstance(route, dict) and isinstance(route.get("id"), str):
            renderables.add(("route", route["id"]))
    families = ledger.get("families")
    if not isinstance(families, list) or not families:
        issues.append("assetLedger.families must be a nonempty list")
        return set()
    mapped_features: dict[tuple[str, str], set[str]] = {}
    component_by_target: dict[tuple[str, str], str] = {}
    category_by_feature: dict[str, str] = {}
    for entry in build_map.get("entries", []):
        if not isinstance(entry, dict) or not isinstance(entry.get("target"), dict):
            continue
        target = entry["target"]
        key = (target.get("type"), target.get("id"))
        mapped_features[key] = {
            feature.get("id") for feature in entry.get("features", [])
            if isinstance(feature, dict) and isinstance(feature.get("id"), str)
        }
        category_by_feature.update({
            feature["id"]: feature.get("category")
            for feature in entry.get("features", [])
            if isinstance(feature, dict) and isinstance(feature.get("id"), str)
        })
        plan = entry.get("implementationPlan", {})
        if isinstance(plan, dict) and isinstance(plan.get("component"), str):
            component_by_target[key] = plan["component"]
    covered: dict[tuple[str, str], str] = {}
    family_ids: set[str] = set()
    for index, family in enumerate(families):
        label = f"assetLedger.families[{index}]"
        if not isinstance(family, dict):
            issues.append(f"{label} must be an object")
            continue
        family_id, priority = family.get("id"), family.get("priority")
        if not isinstance(family_id, str) or not family_id.strip():
            issues.append(f"{label}.id must be a nonempty stable ID")
            continue
        if family_id in family_ids:
            issues.append(f"assetLedger has duplicate family id {family_id}")
        family_ids.add(family_id)
        expected = ASSET_CHECKS_BY_PRIORITY.get(priority)
        if expected is None:
            issues.append(f"{label}.priority must be focal, supporting, or ambient")
            expected = ()
        for field, entity_type in (("objectIds", "object"), ("routeIds", "route")):
            values = family.get(field, [])
            if not isinstance(values, list) or any(not isinstance(value, str) or not value.strip() for value in values):
                issues.append(f"{label}.{field} must be a list of stable IDs")
                continue
            if len(set(values)) != len(values):
                issues.append(f"{label}.{field} contains duplicate IDs")
            for entity_id in values:
                key = (entity_type, entity_id)
                if key in covered:
                    issues.append(f"asset {entity_type} {entity_id} is assigned to multiple families")
                covered[key] = family_id
        checks = family.get("requiredChecks")
        if not isinstance(checks, list):
            issues.append(f"{label}.requiredChecks must be a list")
            continue
        found_checks: set[str] = set()
        for check in checks:
            if not isinstance(check, dict):
                issues.append(f"{label}.requiredChecks entries must be objects")
                continue
            dimension, criterion = check.get("dimension"), check.get("criterion")
            if not isinstance(dimension, str) or dimension not in expected:
                issues.append(f"{label} has unexpected check dimension {dimension}")
                continue
            if dimension in found_checks:
                issues.append(f"{label} has duplicate check dimension {dimension}")
            found_checks.add(dimension)
            if not isinstance(criterion, str) or not criterion.strip():
                issues.append(f"{label} check {dimension} requires a concrete criterion")
        missing_checks = set(expected) - found_checks
        if missing_checks:
            issues.append(f"{label} missing required checks: " + ", ".join(sorted(missing_checks)))
        if not family.get("objectIds") and not family.get("routeIds"):
            issues.append(f"{label} must include at least one object or route")
        family_targets = {("object", item_id) for item_id in family.get("objectIds", []) if isinstance(item_id, str)} | {("route", item_id) for item_id in family.get("routeIds", []) if isinstance(item_id, str)}
        expected_features = set().union(*(mapped_features.get(key, set()) for key in family_targets)) if family_targets else set()
        feature_ids = family.get("visualFeatureIds")
        if not isinstance(feature_ids, list) or any(not isinstance(value, str) or not value.strip() for value in feature_ids):
            issues.append(f"{label}.visualFeatureIds must list stable IDs from visualBuildMap")
            feature_ids = []
        elif len(feature_ids) != len(set(feature_ids)):
            issues.append(f"{label}.visualFeatureIds contains duplicate IDs")
        if set(feature_ids) != expected_features:
            issues.append(f"{label}.visualFeatureIds must cover exactly the mapped features for its scene IDs")
        prototype = family.get("prototype")
        if not isinstance(prototype, dict):
            issues.append(f"{label}.prototype must record the representative-asset quality gate")
            continue
        if prototype.get("buildId") != stage.get("buildId"):
            issues.append(f"{label}.prototype buildId must match middleForms buildId")
        if prototype.get("status") != "PASS":
            issues.append(f"{label}.prototype must PASS before the family can release detail production")
        representative = prototype.get("representativeTarget")
        representative_key = (representative.get("type"), representative.get("id")) if isinstance(representative, dict) else None
        if representative_key not in family_targets:
            issues.append(f"{label}.prototype.representativeTarget must belong to this asset family")
        component = prototype.get("component")
        if not isinstance(component, str) or representative_key not in component_by_target or component_by_target.get(representative_key) != component:
            issues.append(f"{label}.prototype.component must match a visualBuildMap implementation component")
        implementation = prototype.get("implementationSource")
        source_record = _check_file_record(base, implementation, f"{label}.prototype.implementationSource", issues)
        if source_record:
            rel, digest = source_record
            if not any(isinstance(item, dict) and item.get("path") == rel and item.get("sha256") == digest for item in evidence):
                issues.append(f"{label}.prototype.implementationSource must be hashed in middleForms evidence")
            symbol = implementation.get("symbol") if isinstance(implementation, dict) else None
            source_path = _resolve(base, rel)
            if not isinstance(symbol, str) or not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", symbol):
                issues.append(f"{label}.prototype.implementationSource.symbol must name one declared code symbol")
            elif symbol != component:
                issues.append(f"{label}.prototype.implementationSource.symbol must match prototype.component")
            elif source_path:
                try:
                    source_text = source_path.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    source_text = ""
                    issues.append(f"{label}.prototype.implementationSource must be readable source text")
                declaration = rf"\b(?:function|class)\s+{re.escape(symbol)}\b|\b(?:const|let|var)\s+{re.escape(symbol)}\s*="
                if source_text and not re.search(declaration, source_text):
                    issues.append(f"{label}.prototype.implementationSource does not declare {symbol}")
        views = prototype.get("views")
        if not isinstance(views, list) or len(views) < 2:
            issues.append(f"{label}.prototype.views must include at least two complementary captures")
            views = []
        view_ids: set[str] = set()
        role_by_view: dict[str, str] = {}
        for view_index, view in enumerate(views):
            view_label = f"{label}.prototype.views[{view_index}]"
            if not isinstance(view, dict) or not isinstance(view.get("id"), str) or not view.get("id", "").strip():
                issues.append(f"{view_label} requires a stable id")
                continue
            view_id, role = view["id"], view.get("viewRole")
            if view_id in view_ids:
                issues.append(f"{label}.prototype.views has duplicate id {view_id}")
            view_ids.add(view_id)
            if not isinstance(role, str) or role not in PROTOTYPE_VIEW_ROLES:
                issues.append(f"{view_label}.viewRole must be one of: " + ", ".join(sorted(PROTOTYPE_VIEW_ROLES)))
            else:
                role_by_view[view_id] = role
            capture_record = _check_file_record(base, view, view_label, issues)
            if capture_record:
                rel, digest = capture_record
                if not any(isinstance(item, dict) and item.get("path") == rel and item.get("sha256") == digest for item in evidence):
                    issues.append(f"{view_label} must be hashed in middleForms evidence")
                _check_capture_png(base, rel, view_label, issues)
        if len(set(role_by_view.values())) < 2:
            issues.append(f"{label}.prototype.views must use at least two distinct viewRole values")
        reviews = prototype.get("featureReviews")
        if not isinstance(reviews, list):
            issues.append(f"{label}.prototype.featureReviews must review every mapped visual feature")
            continue
        reviewed: dict[str, dict[str, Any]] = {}
        for review in reviews:
            if isinstance(review, dict) and isinstance(review.get("featureId"), str):
                if review["featureId"] in reviewed:
                    issues.append(f"{label}.prototype.featureReviews has duplicate feature id {review['featureId']}")
                reviewed[review["featureId"]] = review
        if set(reviewed) != set(feature_ids):
            issues.append(f"{label}.prototype.featureReviews must cover every visualFeatureId exactly")
        for feature_id in set(feature_ids) & set(reviewed):
            review = reviewed[feature_id]
            if review.get("status") != "PASS" or not isinstance(review.get("observation"), str) or len(review["observation"].strip()) < 20:
                issues.append(f"{label}.prototype feature {feature_id} requires PASS with a concrete visual observation")
            linked_views = review.get("viewIds")
            if not isinstance(linked_views, list) or not linked_views or any(not isinstance(value, str) for value in linked_views) or len(linked_views) != len(set(linked_views)) or not set(linked_views).issubset(view_ids):
                issues.append(f"{label}.prototype feature {feature_id} requires viewIds linked to its hashed prototype views")
                continue
            category = category_by_feature.get(feature_id)
            required_roles = FEATURE_VIEW_REQUIREMENTS.get(category) if isinstance(category, str) else None
            if required_roles:
                roles = {role_by_view.get(view_id) for view_id in linked_views}
                required_primary, required_complement = required_roles
                if not roles.intersection(required_primary) or not roles.intersection(required_complement):
                    issues.append(f"{label}.prototype feature {feature_id} ({category}) needs complementary view roles: one of [{', '.join(sorted(required_primary))}] and one of [{', '.join(sorted(required_complement))}]")
    missing_assets = renderables - set(covered)
    unknown_assets = set(covered) - renderables
    if missing_assets:
        issues.append("assetLedger has unmapped renderable scene IDs: " + ", ".join(f"{kind}:{id}" for kind, id in sorted(missing_assets)))
    if unknown_assets:
        issues.append("assetLedger references unknown or nonrenderable scene IDs: " + ", ".join(f"{kind}:{id}" for kind, id in sorted(unknown_assets)))
    return family_ids


def validate_asset_family_reviews(ledger: dict[str, Any], review: dict[str, Any], capture_ids: set[str], issues: list[str]) -> None:
    families = ledger.get("families", [])
    expected_ids = {item.get("id") for item in families if isinstance(item, dict) and isinstance(item.get("id"), str)}
    records = review.get("familyReviews")
    if not isinstance(records, list):
        issues.append("visualReview: familyReviews must cover every asset family")
        return
    by_id: dict[str, dict[str, Any]] = {}
    for item in records:
        if not isinstance(item, dict) or not isinstance(item.get("familyId"), str):
            issues.append("visualReview: each familyReviews entry requires familyId")
            continue
        family_id = item["familyId"]
        if family_id in by_id:
            issues.append(f"visualReview: duplicate family review {family_id}")
        by_id[family_id] = item
    if set(by_id) != expected_ids:
        issues.append("visualReview: familyReviews must cover every asset family exactly once")
    family_by_id = {item["id"]: item for item in families if isinstance(item, dict) and isinstance(item.get("id"), str)}
    for family_id in expected_ids & set(by_id):
        record = by_id[family_id]
        samples = record.get("reviewedSampleIds")
        if not isinstance(samples, list) or not samples or any(not isinstance(sample, str) for sample in samples) or not set(samples).issubset(capture_ids):
            issues.append(f"visualReview: family {family_id} needs reviewedSampleIds from runtime captures")
        if record.get("status") != "PASS":
            issues.append(f"visualReview: family {family_id} must PASS")
        checks = record.get("checks")
        family = family_by_id[family_id]
        required_checks = family.get("requiredChecks", [])
        if not isinstance(required_checks, list):
            required_checks = []
        required = {item.get("dimension") for item in required_checks if isinstance(item, dict) and isinstance(item.get("dimension"), str)}
        seen: dict[str, dict[str, Any]] = {}
        if isinstance(checks, list):
            for check in checks:
                if isinstance(check, dict) and isinstance(check.get("dimension"), str):
                    seen[check["dimension"]] = check
        else:
            issues.append(f"visualReview: family {family_id} checks must be a list")
        if set(seen) != required:
            issues.append(f"visualReview: family {family_id} checks must cover every required dimension exactly")
        for dimension in required & set(seen):
            check = seen[dimension]
            if check.get("status") != "PASS" or not isinstance(check.get("observation"), str) or not check["observation"].strip():
                issues.append(f"visualReview: family {family_id} {dimension} requires PASS with a concrete observation")
        feature_ids = family.get("visualFeatureIds", []) if isinstance(family, dict) else []
        feature_reviews = item.get("featureReviews")
        if not isinstance(feature_reviews, list):
            issues.append(f"visualReview: family {family_id} featureReviews must review every mapped visual feature")
            continue
        feature_by_id: dict[str, dict[str, Any]] = {}
        for feature_review in feature_reviews:
            if isinstance(feature_review, dict) and isinstance(feature_review.get("featureId"), str):
                feature_id = feature_review["featureId"]
                if feature_id in feature_by_id:
                    issues.append(f"visualReview: family {family_id} has duplicate feature review {feature_id}")
                feature_by_id[feature_id] = feature_review
        if set(feature_by_id) != set(feature_ids):
            issues.append(f"visualReview: family {family_id} featureReviews must cover every visualFeatureId exactly")
        for feature_id in set(feature_ids) & set(feature_by_id):
            feature_review = feature_by_id[feature_id]
            sample_ids = feature_review.get("reviewedSampleIds")
            if feature_review.get("status") != "PASS" or not isinstance(feature_review.get("observation"), str) or len(feature_review["observation"].strip()) < 20:
                issues.append(f"visualReview: family {family_id} feature {feature_id} requires PASS with a concrete observation")
            if not isinstance(sample_ids, list) or not sample_ids or any(not isinstance(sample, str) for sample in sample_ids) or not set(sample_ids).issubset(capture_ids):
                issues.append(f"visualReview: family {family_id} feature {feature_id} needs runtime capture evidence")


def validate_visual_reference_index(base: Path, register_path: Any, index_path: Any, stage: Any, issues: list[str]) -> None:
    """Require an image-backed, scene-wide visual reference handoff before modeling."""
    register_file = _resolve(base, register_path)
    index_file = _resolve(base, index_path)
    if register_file is None:
        issues.append("visualReferences: sceneRegisterPath must reference an existing JSON file")
        return
    if index_file is None:
        issues.append("visualReferenceIndexPath must reference an existing project JSON file")
        return
    index_digest = _hash(index_file)
    evidence = stage.get("evidence", []) if isinstance(stage, dict) else []
    if not any(isinstance(item, dict) and item.get("path") == index_path and item.get("sha256") == index_digest for item in evidence):
        issues.append("visualAnalysis evidence must include visualReferenceIndexPath with its SHA-256")
    register, index = _load_json(register_file), _load_json(index_file)
    if register is None or index is None:
        issues.append("visualReferenceIndex and sceneRegister must be readable JSON objects")
        return
    references = index.get("references")
    if not isinstance(references, list) or not references:
        issues.append("visualReferenceIndex.references must be a nonempty list")
        return
    valid_families = {"global", "plan", "section", "asset-overview", "asset-detail", "joint-detail", "material"}
    valid_sources = {"user", "public", "generated-design", "generated-diagram"}
    target_ids: dict[tuple[str, str], set[str]] = {}
    family_directions: dict[str, set[str]] = {}
    reference_ids: set[str] = set()
    for i, reference in enumerate(references):
        label = f"visualReferenceIndex.references[{i}]"
        if not isinstance(reference, dict):
            issues.append(f"{label} must be an object")
            continue
        ref_id, source_type = reference.get("id"), reference.get("sourceType")
        if not isinstance(ref_id, str) or not ref_id.strip():
            issues.append(f"{label}.id must be a nonempty stable ID")
        elif ref_id in reference_ids:
            issues.append(f"visualReferenceIndex has duplicate reference id {ref_id}")
        else:
            reference_ids.add(ref_id)
        if source_type not in valid_sources:
            issues.append(f"{label}.sourceType must be user, public, generated-design, or generated-diagram")
        for field in ("source", "viewDirection", "purpose"):
            if not isinstance(reference.get(field), str) or not reference[field].strip():
                issues.append(f"{label}.{field} must describe source, view, and purpose")
        limits = reference.get("limits")
        if not isinstance(limits, list) or not limits or any(not isinstance(value, str) or not value.strip() for value in limits):
            issues.append(f"{label}.limits must state what the reference cannot prove")
        if reference.get("confidence") not in {"high", "medium", "low"}:
            issues.append(f"{label}.confidence must be high, medium, or low")
        family = reference.get("viewFamily")
        if family not in valid_families:
            issues.append(f"{label}.viewFamily is not recognized")
        else:
            family_directions.setdefault(family, set()).add(str(reference.get("viewDirection", "")).strip().lower())
        path = _resolve(base, reference.get("path"))
        if path is None:
            issues.append(f"{label}.path must reference an existing project image or drawing")
        elif not isinstance(reference.get("sha256"), str) or reference.get("sha256") != _hash(path):
            issues.append(f"{label}.sha256 must match the referenced image or drawing")
        targets = reference.get("targetIds")
        if not isinstance(targets, list):
            issues.append(f"{label}.targetIds must be a list of scene-register IDs")
            continue
        for target in targets:
            if not isinstance(target, dict) or target.get("type") not in {"object", "route"} or not isinstance(target.get("id"), str):
                issues.append(f"{label}.targetIds entries require type object/route and stable id")
                continue
            key = (target["type"], target["id"])
            target_ids.setdefault(key, set()).add(family if isinstance(family, str) else "")
    if len(family_directions.get("global", set())) < 2:
        issues.append("visualReferenceIndex requires at least two distinct global view directions")
    if not (family_directions.get("plan") or family_directions.get("section")):
        issues.append("visualReferenceIndex requires a plan or section view")
    objects = register.get("objects", [])
    routes = register.get("routes", [])
    renderables = {
        ("object", item["id"]) for item in objects
        if isinstance(item, dict) and item.get("geometryRole") in RENDERABLE_ROLES and isinstance(item.get("id"), str)
    } | {
        ("route", item["id"]) for item in routes
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    unknown = set(target_ids) - renderables
    if unknown:
        issues.append("visualReferenceIndex targets unknown/nonrenderable IDs: " + ", ".join(f"{kind}:{item_id}" for kind, item_id in sorted(unknown)))
    for kind, item_id in sorted(renderables):
        families = target_ids.get((kind, item_id), set())
        expected_views = {"asset-overview", "asset-detail", "joint-detail", "material"} if kind == "object" else {"plan", "section", "asset-overview", "asset-detail"}
        if not (families & expected_views):
            issues.append(f"visualReferenceIndex needs an object/route-focused reference for {kind}:{item_id}")


def validate_visual_build_map(base: Path, register_path: Any, index_path: Any, map_path: Any, stage: Any, issues: list[str]) -> None:
    """Require visual observations to become per-asset constraints and a concrete Three.js plan."""
    register_file, index_file, map_file = (_resolve(base, path) for path in (register_path, index_path, map_path))
    if register_file is None or index_file is None:
        return
    if map_file is None:
        issues.append("visualBuildMapPath must reference an existing project JSON file")
        return
    digest = _hash(map_file)
    evidence = stage.get("evidence", []) if isinstance(stage, dict) else []
    if not any(isinstance(item, dict) and item.get("path") == map_path and item.get("sha256") == digest for item in evidence):
        issues.append("visualAnalysis evidence must include visualBuildMapPath with its SHA-256")
    register, index, build_map = _load_json(register_file), _load_json(index_file), _load_json(map_file)
    if register is None or index is None or build_map is None:
        issues.append("visualBuildMap, visualReferenceIndex, and sceneRegister must be readable JSON objects")
        return
    if isinstance(stage, dict) and build_map.get("buildId") != stage.get("buildId"):
        issues.append("visualBuildMap buildId must match the visualAnalysis stage buildId")
    references = {item.get("id"): item for item in index.get("references", []) if isinstance(item, dict) and isinstance(item.get("id"), str)}
    renderables = {
        ("object", item["id"]) for item in register.get("objects", [])
        if isinstance(item, dict) and item.get("geometryRole") in RENDERABLE_ROLES and isinstance(item.get("id"), str)
    } | {
        ("route", item["id"]) for item in register.get("routes", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    entries = build_map.get("entries")
    if not isinstance(entries, list) or not entries:
        issues.append("visualBuildMap.entries must be a nonempty list")
        return
    covered: dict[tuple[str, str], str] = {}
    entry_ids: set[str] = set()
    feature_ids: set[str] = set()
    minimum_features = {"focal": 3, "supporting": 2, "ambient": 1}
    categories = {"silhouette", "proportion", "volume", "connection", "material", "distribution", "spatial-relation", "detail"}
    for i, entry in enumerate(entries):
        label = f"visualBuildMap.entries[{i}]"
        if not isinstance(entry, dict):
            issues.append(f"{label} must be an object")
            continue
        entry_id = entry.get("id")
        if not isinstance(entry_id, str) or not entry_id.strip():
            issues.append(f"{label}.id must be a nonempty stable ID")
        elif entry_id in entry_ids:
            issues.append(f"visualBuildMap has duplicate entry id {entry_id}")
        else:
            entry_ids.add(entry_id)
        target = entry.get("target")
        if not isinstance(target, dict) or target.get("type") not in {"object", "route"} or not isinstance(target.get("id"), str):
            issues.append(f"{label}.target requires type object/route and stable id")
            continue
        key = (target["type"], target["id"])
        if key not in renderables:
            issues.append(f"{label}.target references unknown/nonrenderable scene ID {key[0]}:{key[1]}")
        if key in covered:
            issues.append(f"visualBuildMap has duplicate target {key[0]}:{key[1]}")
        covered[key] = entry_id if isinstance(entry_id, str) else ""
        priority = entry.get("priority")
        if priority not in minimum_features:
            issues.append(f"{label}.priority must be focal, supporting, or ambient")
        ref_ids = entry.get("referenceIds")
        if not isinstance(ref_ids, list) or not ref_ids:
            issues.append(f"{label}.referenceIds must list one or more references")
            ref_ids = []
        valid_ref_ids = {ref_id for ref_id in ref_ids if isinstance(ref_id, str) and ref_id in references}
        if len(valid_ref_ids) != len(ref_ids):
            issues.append(f"{label}.referenceIds contains unknown or duplicate reference IDs")
        if not any(any(isinstance(t, dict) and t.get("type") == key[0] and t.get("id") == key[1] for t in references[ref_id].get("targetIds", [])) for ref_id in valid_ref_ids):
            issues.append(f"{label} needs a selected reference that targets {key[0]}:{key[1]}")
        features = entry.get("features")
        if not isinstance(features, list):
            issues.append(f"{label}.features must be a list")
            continue
        if priority in minimum_features and len(features) < minimum_features[priority]:
            issues.append(f"{label} needs at least {minimum_features[priority]} visual features for {priority} priority")
        local_features: set[str] = set()
        for j, feature in enumerate(features):
            feature_label = f"{label}.features[{j}]"
            if not isinstance(feature, dict):
                issues.append(f"{feature_label} must be an object")
                continue
            feature_id = feature.get("id")
            if not isinstance(feature_id, str) or not feature_id.strip():
                issues.append(f"{feature_label}.id must be a nonempty stable ID")
            elif feature_id in feature_ids or feature_id in local_features:
                issues.append(f"visualBuildMap has duplicate feature id {feature_id}")
            else:
                feature_ids.add(feature_id)
                local_features.add(feature_id)
            reference_id = feature.get("referenceId")
            if reference_id not in valid_ref_ids:
                issues.append(f"{feature_label}.referenceId must resolve through this entry's referenceIds")
            elif not any(isinstance(t, dict) and t.get("type") == key[0] and t.get("id") == key[1] for t in references[reference_id].get("targetIds", [])):
                issues.append(f"{feature_label}.referenceId must target {key[0]}:{key[1]}")
            if feature.get("category") not in categories:
                issues.append(f"{feature_label}.category is not recognized")
            for field in ("observation", "designConstraint"):
                if not isinstance(feature.get(field), str) or len(feature[field].strip()) < 20:
                    issues.append(f"{feature_label}.{field} must state a specific visible observation/constraint")
            if feature.get("confidence") not in {"high", "medium", "low"}:
                issues.append(f"{feature_label}.confidence must be high, medium, or low")
        plan = entry.get("implementationPlan")
        if not isinstance(plan, dict):
            issues.append(f"{label}.implementationPlan must specify the planned Three.js construction")
        else:
            plan_min_lengths = {"component": 3, "geometryStrategy": 25, "materialTreatment": 25}
            for field, minimum_length in plan_min_lengths.items():
                if not isinstance(plan.get(field), str) or len(plan[field].strip()) < minimum_length:
                    issues.append(f"{label}.implementationPlan.{field} must be concrete")
            component = plan.get("component")
            if isinstance(component, str) and not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", component):
                issues.append(f"{label}.implementationPlan.component must be one concrete code symbol; put the construction explanation in geometryStrategy/constructionSteps")
            steps = plan.get("constructionSteps")
            if not isinstance(steps, list) or len(steps) < 2 or any(not isinstance(step, str) or len(step.strip()) < 20 for step in steps):
                issues.append(f"{label}.implementationPlan.constructionSteps must contain at least two concrete steps")
    missing = renderables - set(covered)
    if missing:
        issues.append("visualBuildMap has unmapped renderable scene IDs: " + ", ".join(f"{kind}:{item_id}" for kind, item_id in sorted(missing)))


def validate_diagram_review(base: Path, report_path: Any, register_path: Any, stage: Any, issues: list[str]) -> None:
    """Require actual raster previews and review records for generated spatial drawings."""
    register_file = _resolve(base, register_path)
    register = _load_json(register_file) if register_file else None
    if register is None:
        issues.append("diagramReviewReport requires a readable scene register")
        return
    report_file = _resolve(base, report_path)
    if report_file is None:
        issues.append("diagramReviewReportPath must reference an existing project JSON file")
        return
    report_digest = _hash(report_file)
    evidence = stage.get("evidence", []) if isinstance(stage, dict) else []
    if not any(isinstance(item, dict) and item.get("path") == report_path and item.get("sha256") == report_digest for item in evidence):
        issues.append("visualAnalysis evidence must include diagramReviewReportPath with its SHA-256")
    report = _load_json(report_file)
    if report is None:
        issues.append("diagramReviewReport must be a readable JSON object")
        return
    if report.get("buildId") != (stage.get("buildId") if isinstance(stage, dict) else None):
        issues.append("diagramReviewReport buildId must match visualAnalysis buildId")
    if not isinstance(report.get("reviewer"), str) or not report["reviewer"].strip():
        issues.append("diagramReviewReport requires a named reviewer")
    drawings = report.get("drawings")
    if not isinstance(drawings, list) or not drawings:
        issues.append("diagramReviewReport.drawings must list rendered plan/section previews")
        return
    seen: dict[str, set[str]] = {"plan": set(), "section": set()}
    for i, drawing in enumerate(drawings):
        label = f"diagramReviewReport.drawings[{i}]"
        if not isinstance(drawing, dict):
            issues.append(f"{label} must be an object")
            continue
        kind, drawing_id = drawing.get("kind"), drawing.get("id")
        if kind not in seen or not isinstance(drawing_id, str) or not drawing_id.strip():
            issues.append(f"{label} requires kind plan/section and a stable drawing ID")
            continue
        if drawing_id in seen[kind]:
            issues.append(f"{label} duplicates {kind} drawing ID {drawing_id}")
        seen[kind].add(drawing_id)
        if drawing.get("status") != "PASS" or not isinstance(drawing.get("observation"), str) or len(drawing["observation"].strip()) < 20:
            issues.append(f"{label} requires PASS with a concrete visual inspection observation")
        source = drawing.get("source")
        source_record = _check_file_record(base, source, f"{label}.source", issues)
        if source_record and Path(source_record[0]).suffix.lower() not in {".svg", ".pdf"}:
            issues.append(f"{label}.source must be an SVG or PDF drawing")
        if source_record and not any(isinstance(item, dict) and item.get("path") == source_record[0] and item.get("sha256") == source_record[1] for item in evidence):
            issues.append(f"{label}.source must be hashed in visualAnalysis evidence")
        preview = drawing.get("preview")
        preview_record = _check_file_record(base, preview, f"{label}.preview", issues)
        if preview_record:
            rel, digest = preview_record
            if not any(isinstance(item, dict) and item.get("path") == rel and item.get("sha256") == digest for item in evidence):
                issues.append(f"{label}.preview must be hashed in visualAnalysis evidence")
            preview_file = _resolve(base, rel)
            try:
                header = preview_file.read_bytes()[:24] if preview_file else b""
            except OSError:
                header = b""
            if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
                issues.append(f"{label}.preview must have a PNG signature and IHDR header")
            else:
                width, height = struct.unpack(">II", header[16:24])
                if max(width, height) < 640 or min(width, height) < 320:
                    issues.append(f"{label}.preview must be at least 640px on its long edge and 320px on its short edge")
    if not seen["plan"]:
        issues.append("diagramReviewReport requires at least one visually reviewed plan")
    if not seen["section"]:
        issues.append("diagramReviewReport requires at least one visually reviewed section")
    expected_sections = {item.get("id") for item in register.get("sections", []) if isinstance(item, dict) and isinstance(item.get("id"), str)}
    if expected_sections - seen["section"]:
        issues.append("diagramReviewReport is missing registered sections: " + ", ".join(sorted(expected_sections - seen["section"])))


def validate_data(data: Any, base: Path, through: str | None = None) -> list[str]:
    issues: list[str] = []
    if not isinstance(data, dict):
        return ["manifest must be a JSON object"]
    if data.get("schemaVersion") != 1:
        issues.append("schemaVersion must equal 1")
    mode = data.get("mode")
    required_stages = MODE_STAGES.get(mode)
    if required_stages is None:
        return issues + ["mode must be mechanism-test, analysis-only, spatial-handoff, or full-production"]
    if through is not None:
        if through not in required_stages:
            return issues + [f"--through stage {through} is not part of mode {mode}"]
        required_stages = required_stages[:required_stages.index(through) + 1]
    build_id = data.get("buildId")
    if not isinstance(build_id, str) or not build_id.strip():
        issues.append("buildId must be a nonempty string")

    stages = data.get("stages")
    if not isinstance(stages, list):
        return issues + ["stages must be an ordered list"]
    if through is not None:
        allowed = set(required_stages)
        stages = [stage for stage in stages if isinstance(stage, dict) and stage.get("id") in allowed]
    by_id: dict[str, dict[str, Any]] = {}
    positions: dict[str, int] = {}
    stage_outputs: dict[str, set[tuple[str, str]]] = {}
    for index, stage in enumerate(stages):
        if not isinstance(stage, dict) or not isinstance(stage.get("id"), str):
            issues.append(f"stages[{index}] must have a stable id")
            continue
        stage_id = stage["id"]
        if stage_id not in ALL_STAGES:
            issues.append(f"stages[{index}]: unknown stage {stage_id}")
            continue
        if stage_id in by_id:
            issues.append(f"duplicate stage id {stage_id}")
            continue
        by_id[stage_id] = stage
        positions[stage_id] = index
        if stage.get("status") != "PASS":
            issues.append(f"stage {stage_id} must be PASS to release this scope")
        stage_build = stage.get("buildId")
        if not isinstance(stage_build, str) or not stage_build.strip():
            issues.append(f"stage {stage_id} requires its own buildId")
        if mode == "full-production" and stage_id in {"runtime", "visualReview", "delivery"} and build_id and stage_build != build_id:
            issues.append(f"stage {stage_id} buildId must match final manifest buildId")
        evidence = stage.get("evidence")
        outputs: set[tuple[str, str]] = set()
        if not isinstance(evidence, list) or not evidence:
            issues.append(f"stage {stage_id} requires hashed evidence outputs")
        else:
            for evidence_index, item in enumerate(evidence):
                result = _check_file_record(base, item, f"stage {stage_id} evidence[{evidence_index}]", issues)
                if result:
                    outputs.add(result)
        stage_outputs[stage_id] = outputs

        inputs = stage.get("inputs", [])
        if not isinstance(inputs, list):
            issues.append(f"stage {stage_id} inputs must be a list")
            inputs = []
        if index > 0 and not inputs:
            issues.append(f"stage {stage_id} must record its upstream inputs")
        available = set().union(*(stage_outputs.get(previous, set()) for previous in by_id if positions[previous] < index))
        for input_index, item in enumerate(inputs):
            result = _check_file_record(base, item, f"stage {stage_id} input[{input_index}]", issues)
            if result and result not in available:
                issues.append(f"stage {stage_id} input {result[0]} was not produced by an earlier stage")

    missing_stages = [stage for stage in required_stages if stage not in by_id]
    if missing_stages:
        issues.append("required stages missing: " + ", ".join(missing_stages))
    order = [stage for stage, _ in sorted(positions.items(), key=lambda item: item[1]) if stage in required_stages]
    if order != [stage for stage in required_stages if stage in by_id]:
        issues.append("stage order must follow the declared production pipeline")

    if "visualAnalysis" in required_stages:
        if "runtimePreflight" in required_stages:
            _validate_runtime_preflight(base, by_id.get("runtimePreflight", {}), issues)
        register_rel = data.get("sceneRegisterPath")
        register = _resolve(base, register_rel)
        if register is None:
            issues.append("sceneRegisterPath must reference an existing project JSON file")
        else:
            stage = by_id.get("visualAnalysis", {})
            if not any(item[0] == register_rel for item in stage_outputs.get("visualAnalysis", set())):
                issues.append("visualAnalysis evidence must include sceneRegisterPath with its SHA-256")
            _run_specialist("validate_scene_register.py", register, base, "visualAnalysis", issues)
            validate_visual_reference_index(
                base, register_rel, data.get("visualReferenceIndexPath"), by_id.get("visualAnalysis", {}), issues,
            )
            validate_visual_build_map(
                base, register_rel, data.get("visualReferenceIndexPath"), data.get("visualBuildMapPath"),
                by_id.get("visualAnalysis", {}), issues,
            )
            validate_diagram_review(
                base, data.get("diagramReviewReportPath"), register_rel,
                by_id.get("visualAnalysis", {}), issues,
            )

        if "middleForms" in required_stages:
            validate_asset_ledger(
                base, register_rel, data.get("assetLedgerPath"), data.get("visualBuildMapPath"),
                by_id.get("middleForms", {}), issues,
            )

        if "spatialProxy" in required_stages:
            proxy_stage = by_id.get("spatialProxy", {})
            if proxy_stage.get("status") == "PASS":
                gate_rel = data.get("spatialGatePath")
                gate = _resolve(base, gate_rel)
                if gate is None:
                    issues.append("spatialGatePath must reference an existing project JSON file")
                else:
                    if not any(item[0] == gate_rel for item in stage_outputs.get("spatialProxy", set())):
                        issues.append("spatialProxy evidence must include spatialGatePath with its SHA-256")
                    gate_data = _load_json(gate)
                    gate_proxy = gate_data.get("proxyStage") if gate_data else None
                    if isinstance(gate_proxy, dict) and proxy_stage.get("buildId") != gate_proxy.get("buildId"):
                        issues.append("spatialProxy stage buildId must match the gate's frozen proxy buildId")
                    visual_map_rel = data.get("visualBuildMapPath")
                    visual_map_file = _resolve(base, visual_map_rel)
                    visual_map_digest = _hash(visual_map_file) if visual_map_file else None
                    proxy_inputs = {
                        (item.get("path"), item.get("sha256"))
                        for item in proxy_stage.get("inputs", []) if isinstance(item, dict)
                    }
                    if not visual_map_file or (visual_map_rel, visual_map_digest) not in proxy_inputs:
                        issues.append("spatialProxy inputs must include visualBuildMapPath with its current SHA-256")
                    if isinstance(gate_proxy, dict) and gate_proxy.get("visualBuildMap") != visual_map_rel:
                        issues.append("proxyStage must review the same visualBuildMapPath produced by visualAnalysis")
                    _run_specialist("validate_spatial_gate.py", gate, base, "spatialProxy", issues)

    if mode == "full-production" and "runtime" in required_stages:
        camera_stage = by_id.get("cameraMotion", {})
        camera_contract_path = data.get("cameraContractPath")
        camera_contract_file = _resolve(base, camera_contract_path)
        camera_contract_hash = _hash(camera_contract_file) if camera_contract_file else None
        camera_evidence = {
            (item.get("path"), item.get("sha256"))
            for item in camera_stage.get("evidence", []) if isinstance(item, dict)
        }
        if not camera_contract_file:
            issues.append("cameraContractPath must reference an existing project JSON file")
        elif (camera_contract_path, camera_contract_hash) not in camera_evidence:
            issues.append("cameraMotion evidence must include cameraContractPath with its SHA-256")
        runtime_stage = by_id.get("runtime", {})
        runtime_inputs = {
            (item.get("path"), item.get("sha256"))
            for item in runtime_stage.get("inputs", []) if isinstance(item, dict)
        }
        if camera_contract_file and (camera_contract_path, camera_contract_hash) not in runtime_inputs:
            issues.append("runtime inputs must reference the final camera contract artifact")
        runtime_ids = _validate_runtime_report(base, runtime_stage.get("runtimeReport"), runtime_stage.get("buildId", ""), camera_contract_path, issues)
        if "visualReview" in required_stages:
            review_stage = by_id.get("visualReview", {})
            camera_contract = _load_json(camera_contract_file) if camera_contract_file else None
            _validate_visual_review(base, review_stage.get("visualReviewReport"), review_stage.get("buildId", ""), runtime_ids, camera_contract.get("mode", "") if camera_contract else "", issues)
            ledger_path = _resolve(base, data.get("assetLedgerPath"))
            review_path = _resolve(base, review_stage.get("visualReviewReport"))
            ledger_data = _load_json(ledger_path) if ledger_path else None
            review_data = _load_json(review_path) if review_path else None
            if ledger_data is not None and review_data is not None:
                validate_asset_family_reviews(ledger_data, review_data, runtime_ids, issues)
        if "delivery" in required_stages:
            delivery = by_id.get("delivery", {})
            deliverables = data.get("deliverables")
            delivered: set[tuple[str, str]] = set()
            if not isinstance(deliverables, list) or not deliverables:
                issues.append("full-production requires at least one final deliverable")
            else:
                for index, item in enumerate(deliverables):
                    if not isinstance(item, dict) or not isinstance(item.get("kind"), str) or not item["kind"].strip():
                        issues.append(f"deliverables[{index}] requires kind, path, and sha256")
                        continue
                    result = _check_file_record(base, item, f"deliverable[{index}]", issues)
                    if result:
                        delivered.add(result)
                if not delivered.issubset(stage_outputs.get("delivery", set())):
                    issues.append("delivery stage evidence must hash every final deliverable")
    return issues


def validate_manifest(manifest: Path, through: str | None = None) -> list[str]:
    data = _load_json(manifest)
    if data is None:
        return ["manifest must be a readable JSON object"]
    return validate_data(data, manifest.resolve().parent, through=through)


def main(argv: list[str]) -> int:
    if len(argv) not in {2, 4} or (len(argv) == 4 and argv[2] != "--through"):
        print("usage: validate_delivery.py path/to/delivery-manifest.json [--through STAGE_ID]", file=sys.stderr)
        return 2
    through = argv[3] if len(argv) == 4 else None
    issues = validate_manifest(Path(argv[1]), through=through)
    if issues:
        print("DELIVERY_BLOCKED")
        for issue in issues:
            print(f"- {issue}")
        return 1
    print("DELIVERY_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
