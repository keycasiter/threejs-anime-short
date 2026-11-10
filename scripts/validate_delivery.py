#!/usr/bin/env python3
"""Validate a scope-aware Three.js production handoff manifest.

This checks stage completeness, artifact hashes, handoff provenance, and the
existing specialist validators. It does not judge visual quality by itself.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import subprocess
import sys
import struct
from pathlib import Path
from typing import Any
from validate_scene_register import point_in_plan_shape_xz

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
DISTRIBUTION_METHODS = {"manual", "grid", "clustered", "poisson", "field-sampled", "path-sampled", "hybrid"}
DISTRIBUTION_VIEW_ROLES = {"context", "distribution-map", "detail"}
DISTRIBUTION_CHECKS = {"coverage", "spacing-rhythm", "variation", "screen-scale", "support-clearance"}
DISTRIBUTION_PATTERNS = {"uniform", "grid", "clustered", "gradient", "edge-following", "path-following", "curated", "volume-layered", "mixed"}
LOOKDEV_SOURCE_ROLES = {"material-binding", "lighting", "render-output"}


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


def _validate_html_deliverable(kind: str, target: Path, base: Path, issues: list[str]) -> None:
    script = Path(__file__).resolve().with_name("validate_offline_html.mjs")
    command = ["node", str(script), str(target)]
    if kind == "offline-html":
        command.append("--require-offline")
    try:
        result = subprocess.run(command, cwd=base, capture_output=True, text=True, check=False)
    except OSError as exc:
        issues.append(f"deliverable {target.name}: could not run validate_offline_html.mjs: {exc}")
        return
    if result.returncode != 0:
        detail = (result.stdout + result.stderr).strip().replace("\n", " | ")
        issues.append(f"deliverable {target.name}: final HTML static check blocked ({detail})")


def _parse_frame_rate(value: Any) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        numerator, denominator = value.split("/", 1)
        denominator_value = float(denominator)
        return float(numerator) / denominator_value if denominator_value else None
    except (ValueError, ZeroDivisionError):
        try:
            return float(value)
        except ValueError:
            return None


def _validate_probe_contract(probe: Any, contract: dict[str, Any], label: str, issues: list[str]) -> None:
    streams = probe.get("streams", []) if isinstance(probe, dict) else []
    video_streams = [stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "video"]
    audio_streams = [stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "audio"]
    if len(video_streams) != 1:
        issues.append(f"{label}: expected exactly one video stream")
        return
    video = video_streams[0]
    try:
        width, height = int(contract.get("width")), int(contract.get("height"))
        fps, duration = float(contract.get("fps")), float(contract.get("duration"))
    except (TypeError, ValueError):
        issues.append(f"{label}: report must declare numeric width, height, fps, and duration")
        return
    if width <= 0 or height <= 0 or fps <= 0 or duration <= 0:
        issues.append(f"{label}: width, height, fps, and duration must be positive")
        return
    rate = _parse_frame_rate(video.get("avg_frame_rate") or video.get("r_frame_rate"))
    expected_frames = math.ceil(duration * fps)
    expected_duration = expected_frames / fps
    if video.get("width") != width or video.get("height") != height:
        issues.append(f"{label}: encoded dimensions do not match the declared {width}x{height}")
    if rate is None or abs(rate - fps) > 1e-6:
        issues.append(f"{label}: encoded frame rate does not match declared {fps} fps")
    try:
        actual_frames = int(video.get("nb_frames"))
    except (TypeError, ValueError):
        actual_frames = -1
    if actual_frames != expected_frames:
        issues.append(f"{label}: encoded frame count {actual_frames} does not match {expected_frames}")
    try:
        actual_duration = float(video.get("duration"))
    except (TypeError, ValueError):
        actual_duration = math.nan
    if not math.isfinite(actual_duration) or abs(actual_duration - expected_duration) > max(1e-6, .01 / fps):
        issues.append(f"{label}: encoded duration does not match {expected_duration:g}s")
    audio_mode = contract.get("audioMode")
    if audio_mode == "none":
        if audio_streams:
            issues.append(f"{label}: encoded audio stream conflicts with audioMode none")
    elif audio_mode == "wav":
        if len(audio_streams) != 1:
            issues.append(f"{label}: audioMode wav requires exactly one encoded audio stream")
        else:
            audio = audio_streams[0]
            if str(audio.get("sample_rate")) != "22050":
                issues.append(f"{label}: encoded audio sample rate does not match 22050 Hz")
            try:
                audio_duration = float(audio.get("duration"))
            except (TypeError, ValueError):
                audio_duration = math.nan
            if not math.isfinite(audio_duration) or abs(audio_duration - expected_duration) > 1 / fps:
                issues.append(f"{label}: encoded audio duration does not match the video")
    else:
        issues.append(f"{label}: audioMode must be none or wav")


def _validate_video_deliverable(base: Path, item: dict[str, Any], build_id: str, runtime_tested: tuple[str, str] | None, delivery_outputs: set[tuple[str, str]], issues: list[str]) -> None:
    report_record = item.get("exportReport")
    report_path = _resolve(base, report_record)
    if report_path is None:
        issues.append(f"MP4 deliverable {item.get('path')}: exportReport must reference a project JSON file")
        return
    report_hash = _hash(report_path)
    report_relative = report_path.relative_to(base.resolve()).as_posix()
    if (report_relative, report_hash) not in delivery_outputs:
        issues.append("delivery evidence must hash the MP4 export report")
    report = _load_json(report_path)
    if report is None or report.get("status") != "PASS":
        issues.append("MP4 export report must be readable JSON with status PASS")
        return
    artifact_record = _check_file_record(report_path.parent, report.get("videoArtifact"), "MP4 export videoArtifact", issues)
    artifact_path_value = report.get("videoArtifact", {}).get("path") if isinstance(report.get("videoArtifact"), dict) else None
    artifact_path = _resolve(report_path.parent, artifact_path_value)
    deliverable_path = _resolve(base, item.get("path"))
    if deliverable_path is None:
        return
    if artifact_record and artifact_path and deliverable_path and artifact_path.resolve() != deliverable_path.resolve():
        issues.append("MP4 export videoArtifact path must resolve to the exact final deliverable")
    if artifact_record and artifact_record[1] != item.get("sha256"):
        issues.append("MP4 export videoArtifact SHA-256 must match the final deliverable")
    if runtime_tested and report.get("sourceHash") != runtime_tested[1]:
        issues.append("MP4 export sourceHash must match runtime testedArtifact SHA-256")
    contract = {key: report.get(key) for key in ("width", "height", "fps", "duration", "audioMode")}
    try:
        actual_probe = json.loads(subprocess.run(
            ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(deliverable_path)],
            cwd=base, capture_output=True, text=True, check=True,
        ).stdout)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        issues.append(f"MP4 deliverable could not be independently probed with ffprobe: {exc}")
        return
    _validate_probe_contract(actual_probe, contract, "MP4 deliverable", issues)
    _validate_probe_contract(report.get("video"), contract, "MP4 export report probe", issues)
    samples = _validate_video_samples(base, report_path.parent, deliverable_path, report, delivery_outputs, issues)
    _validate_video_review(base, item.get("videoReviewReport"), item, build_id, samples, delivery_outputs, issues)
    if report.get("audioMode") == "wav":
        try:
            duration = math.ceil(float(report.get("duration")) * float(report.get("fps"))) / float(report.get("fps"))
        except (TypeError, ValueError, ZeroDivisionError):
            duration = 0
        _validate_audio_review(base, item.get("audioReviewReport"), item, build_id, duration, delivery_outputs, issues)


def _verify_video_sample_provenance(video_path: Path, sample_time: float, expected_sha256: str, label: str, issues: list[str]) -> bool:
    try:
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{sample_time:.6f}", "-i", str(video_path),
             "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
            capture_output=True, check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        issues.append(f"{label} could not be independently decoded from the final MP4 with ffmpeg: {exc}")
        return False
    actual = hashlib.sha256(result.stdout).hexdigest()
    if actual != expected_sha256:
        issues.append(f"{label} does not match a frame independently decoded from the final MP4")
        return False
    return True


def _validate_video_samples(project_dir: Path, export_dir: Path, video_path: Path, report: dict[str, Any], delivery_outputs: set[tuple[str, str]], issues: list[str]) -> list[str]:
    samples = report.get("videoSamples")
    if not isinstance(samples, list):
        issues.append("MP4 export report requires post-encode videoSamples")
        return []
    ids: list[str] = []
    frame_times: list[float] = []
    frame_indexes: list[int] = []
    for index, sample in enumerate(samples):
        if not isinstance(sample, dict):
            issues.append(f"videoSamples[{index}] must be an object")
            continue
        sample_id = sample.get("id")
        if not isinstance(sample_id, str) or not sample_id.strip():
            issues.append(f"videoSamples[{index}] requires an id")
        else:
            ids.append(sample_id)
        sample_time = None
        try:
            sample_time = float(sample.get("t"))
            if not math.isfinite(sample_time) or sample_time < 0:
                raise ValueError
            frame_times.append(sample_time)
        except (TypeError, ValueError):
            issues.append(f"videoSamples[{index}] requires a nonnegative encoded time")
        try:
            frame_indexes.append(int(sample.get("frame")))
        except (TypeError, ValueError):
            issues.append(f"videoSamples[{index}] requires an encoded frame index")
        record = _check_file_record(export_dir, {"path": sample.get("file"), "sha256": sample.get("sha256")}, f"videoSamples[{index}]", issues)
        if record:
            _relative, digest = record
            frame_path = _resolve(export_dir, sample.get("file"))
            try:
                evidence_path = frame_path.relative_to(project_dir.resolve()).as_posix() if frame_path else ""
            except ValueError:
                evidence_path = ""
            if not evidence_path or (evidence_path, digest) not in delivery_outputs:
                issues.append(f"delivery evidence must hash encoded frame {sample.get('file')}")
            header = frame_path.read_bytes()[:24] if frame_path else b""
            if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
                issues.append(f"videoSamples[{index}] must be a real post-encode PNG")
            elif struct.unpack(">II", header[16:24]) != (report.get("width"), report.get("height")):
                issues.append(f"videoSamples[{index}] dimensions must match the encoded MP4")
            if sample_time is not None:
                _verify_video_sample_provenance(video_path, sample_time, digest, f"videoSamples[{index}]", issues)
    if len(ids) != len(set(ids)):
        issues.append("videoSamples ids must be unique")
    if frame_times != sorted(frame_times) or len(frame_times) != len(set(frame_times)):
        issues.append("videoSamples times must be unique and ordered along the encoded timeline")
    try:
        probe = report.get("video")
        streams = probe.get("streams", []) if isinstance(probe, dict) else []
        video_stream = next(stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "video")
        rate_parts = str(video_stream.get("avg_frame_rate", "0/1")).split("/")
        fps = float(rate_parts[0]) / float(rate_parts[1])
        total_frames = int(video_stream.get("nb_frames"))
        last_frame = total_frames - 1
        required_frames = {math.floor(last_frame * fraction + .5) for fraction in (0, .25, .5, .75, 1)}
        if not required_frames.issubset(set(frame_indexes)):
            issues.append("videoSamples must cover opening, quarter, midpoint, three-quarter, and ending encoded frames")
        if len(frame_indexes) < min(5, total_frames):
            issues.append("videoSamples must cover at least five encoded positions, or every frame for clips shorter than five frames")
        if len(frame_indexes) != len(set(frame_indexes)) or any(frame < 0 or frame >= total_frames for frame in frame_indexes):
            issues.append("videoSamples frame indexes must be unique and inside the encoded MP4")
        for sample, frame_index in zip(samples, frame_indexes):
            if isinstance(sample, dict):
                try:
                    mismatched = abs(float(sample.get("t")) - frame_index / fps) > 1e-6
                except (TypeError, ValueError, ZeroDivisionError):
                    mismatched = True
                if mismatched:
                    issues.append("videoSamples time must match its encoded frame index")
                    break
        if "ending" in ids:
            ending = next(float(sample.get("t")) for sample in samples if isinstance(sample, dict) and sample.get("id") == "ending")
            if abs(ending - last_frame / fps) > 1e-6:
                issues.append("ending videoSample must target the last encoded frame, before MP4 duration")
    except (StopIteration, TypeError, ValueError, ZeroDivisionError):
        issues.append("MP4 export report must expose frame rate and frame count to validate ending sample")
    return ids


def _validate_video_review(base: Path, record: Any, item: dict[str, Any], build_id: str, sample_ids: list[str], delivery_outputs: set[tuple[str, str]], issues: list[str]) -> None:
    if not isinstance(record, str) or not record.strip():
        issues.append("MP4 deliverable requires videoReviewReport for the encoded file")
        return
    path = _resolve(base, record)
    review = _load_json(path) if path else None
    if review is None:
        issues.append("videoReviewReport must reference an existing project JSON file")
        return
    report_hash = _hash(path)
    report_relative = path.relative_to(base.resolve()).as_posix()
    if (report_relative, report_hash) not in delivery_outputs:
        issues.append("delivery evidence must hash the video review report")
    if review.get("status") != "PASS" or review.get("buildId") != build_id:
        issues.append("video review report must PASS and match the final buildId")
    if not isinstance(review.get("reviewer"), str) or not review["reviewer"].strip():
        issues.append("video review report requires a named reviewer")
    playback = review.get("playback")
    if not isinstance(playback, dict):
        issues.append("video review requires playback method, device, and completion status")
        playback = {}
    for key in ("method", "device"):
        if not isinstance(playback.get(key), str) or not playback[key].strip():
            issues.append(f"video review playback requires {key}")
    if playback.get("completePlayback") is not True:
        issues.append("video review must record completePlayback=true for the final MP4")
    reviewed = _check_file_record(base, review.get("reviewedArtifact"), "video review reviewedArtifact", issues)
    deliverable = _check_file_record(base, item, "video review MP4 deliverable", issues)
    if reviewed and deliverable and reviewed != deliverable:
        issues.append("video review reviewedArtifact must match the exact final MP4 path and SHA-256")
    reviewed_ids = review.get("reviewedSampleIds")
    valid_reviewed_ids = isinstance(reviewed_ids, list) and all(isinstance(sample_id, str) for sample_id in reviewed_ids)
    if not valid_reviewed_ids or len(reviewed_ids) != len(set(reviewed_ids)) or set(reviewed_ids) != set(sample_ids):
        issues.append("video review reviewedSampleIds must exactly match the encoded videoSamples")
    required = {"framing-readability", "encoding-artifacts", "temporal-continuity"}
    checks = review.get("checks")
    if not isinstance(checks, dict):
        issues.append("video review checks must be an object")
        checks = {}
    if required - set(checks):
        issues.append("video review is missing checks: " + ", ".join(sorted(required - set(checks))))
    if set(checks) - required:
        issues.append("video review has unknown checks: " + ", ".join(sorted(set(checks) - required)))
    for check_id in sorted(required & set(checks)):
        check = checks[check_id]
        if not isinstance(check, dict) or check.get("status") != "PASS":
            issues.append(f"video review {check_id} must PASS")
            continue
        observation = check.get("observation")
        if not isinstance(observation, str) or len(observation.strip()) < 16:
            issues.append(f"video review {check_id} PASS requires a concrete observation")
        cited = check.get("sampleIds")
        if not isinstance(cited, list) or not all(isinstance(sample_id, str) for sample_id in cited) or set(cited) != set(sample_ids):
            issues.append(f"video review {check_id} must cite all encoded review samples")


def _validate_audio_review(base: Path, record: Any, item: dict[str, Any], build_id: str, duration: float, delivery_outputs: set[tuple[str, str]], issues: list[str]) -> None:
    if not isinstance(record, str) or not record.strip():
        issues.append("audio-bearing MP4 deliverable requires audioReviewReport")
        return
    path = _resolve(base, record)
    report = _load_json(path) if path else None
    if report is None:
        issues.append("audioReviewReport must reference an existing project JSON file")
        return
    report_hash = _hash(path)
    report_relative = path.relative_to(base.resolve()).as_posix()
    if (report_relative, report_hash) not in delivery_outputs:
        issues.append("delivery evidence must hash the audio review report")
    if report.get("status") != "PASS" or report.get("buildId") != build_id:
        issues.append("audio review report must PASS and match the final buildId")
    reviewer = report.get("reviewer")
    playback = report.get("playback")
    if not isinstance(reviewer, str) or not reviewer.strip():
        issues.append("audio review report requires a named reviewer")
    if not isinstance(playback, dict):
        issues.append("audio review report requires playback method, device, and completion status")
        playback = {}
    for key in ("method", "device"):
        if not isinstance(playback.get(key), str) or not playback[key].strip():
            issues.append(f"audio review playback requires {key}")
    if playback.get("completePlayback") is not True:
        issues.append("audio review must record completePlayback=true for the final short film")
    reviewed = _check_file_record(base, report.get("reviewedArtifact"), "audio review reviewedArtifact", issues)
    deliverable = _check_file_record(base, item, "audio review MP4 deliverable", issues)
    if reviewed and deliverable and reviewed != deliverable:
        issues.append("audio review reviewedArtifact must match the exact final MP4 path and SHA-256")

    required_checks = {"sync", "level-balance", "clipping-distortion", "noise-floor", "transitions-tail"}
    checks = report.get("checks")
    if not isinstance(checks, dict):
        issues.append("audio review checks must be an object")
        checks = {}
    missing = required_checks - set(checks)
    extra = set(checks) - required_checks
    if missing:
        issues.append("audio review is missing checks: " + ", ".join(sorted(missing)))
    if extra:
        issues.append("audio review has unknown checks: " + ", ".join(sorted(extra)))
    for check_id in sorted(required_checks & set(checks)):
        check = checks[check_id]
        if not isinstance(check, dict):
            issues.append(f"audio review {check_id} must be an object")
            continue
        status = check.get("status")
        if status == "PASS":
            observation = check.get("observation")
            if not isinstance(observation, str) or len(observation.strip()) < 16:
                issues.append(f"audio review {check_id} PASS requires a concrete observation")
        elif status == "NOT_APPLICABLE":
            reason = check.get("reason")
            if not isinstance(reason, str) or len(reason.strip()) < 12:
                issues.append(f"audio review {check_id} NOT_APPLICABLE requires a reason")
        else:
            issues.append(f"audio review {check_id} must PASS or be explicitly NOT_APPLICABLE")

    segments = report.get("timedSegments")
    if not isinstance(segments, list) or len(segments) < 3:
        issues.append("audio review must cite at least three timed listening observations")
        return
    normalized: list[tuple[float, float]] = []
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            issues.append(f"audio review timedSegments[{index}] must be an object")
            continue
        try:
            start, end = float(segment.get("startSeconds")), float(segment.get("endSeconds"))
        except (TypeError, ValueError):
            issues.append(f"audio review timedSegments[{index}] requires numeric startSeconds/endSeconds")
            continue
        if start < 0 or end <= start or end > duration + 1e-6:
            issues.append(f"audio review timedSegments[{index}] must be an ordered range inside the final MP4")
        if not isinstance(segment.get("focus"), str) or not segment["focus"].strip():
            issues.append(f"audio review timedSegments[{index}] requires a listening focus")
        if not isinstance(segment.get("observation"), str) or len(segment["observation"].strip()) < 16:
            issues.append(f"audio review timedSegments[{index}] requires a concrete listening observation")
        normalized.append((start, end))
    normalized.sort()
    if normalized and normalized[0][0] > 0.05:
        issues.append("audio review timed observations must include the opening")
    if normalized and not any(start <= duration / 2 <= end for start, end in normalized):
        issues.append("audio review timed observations must include the midpoint")
    if normalized and normalized[-1][1] < duration - 0.05:
        issues.append("audio review timed observations must include the ending")


def _validate_runtime_report(base: Path, record: Any, build_id: str, camera_contract_path: Any, stage: Any, issues: list[str]) -> set[str]:
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
    tested_artifact = _check_file_record(base, report.get("testedArtifact"), "runtime testedArtifact", issues)
    stage = stage if isinstance(stage, dict) else {}
    if tested_artifact:
        if Path(tested_artifact[0]).suffix.lower() not in {".html", ".htm"}:
            issues.append("runtime testedArtifact must be the exact HTML page opened in the target browser")
        runtime_inputs = {
            (item.get("path"), item.get("sha256"))
            for item in stage.get("inputs", []) if isinstance(item, dict)
        }
        if tested_artifact not in runtime_inputs:
            issues.append("runtime inputs must include the exact testedArtifact path and SHA-256")
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


def validate_camera_interaction_report(
    base: Path, report_path: Any, contract_path: Any, stage: Any, issues: list[str],
) -> None:
    """Require real-page orbit, zoom, and reset actions with state-linked captures."""
    report_file = _resolve(base, report_path)
    contract_file = _resolve(base, contract_path)
    if report_file is None:
        issues.append("cameraInteractionReportPath must reference an existing project JSON file")
        return
    if contract_file is None:
        issues.append("camera interaction requires an existing camera contract")
        return
    report = _load_json(report_file)
    contract = _load_json(contract_file)
    if report is None or contract is None:
        issues.append("camera interaction report and camera contract must be readable JSON objects")
        return
    stage = stage if isinstance(stage, dict) else {}
    evidence = stage.get("evidence", [])
    report_hash = _hash(report_file)
    if not any(isinstance(item, dict) and item.get("path") == report_path and item.get("sha256") == report_hash for item in evidence):
        issues.append("cameraMotion evidence must include cameraInteractionReportPath with its SHA-256")
    if report.get("schemaVersion") != 1 or report.get("status") != "PASS" or report.get("buildId") != stage.get("buildId"):
        issues.append("camera interaction report must use schemaVersion 1, PASS, and match cameraMotion buildId")
    for field in ("method", "inputModality", "browser"):
        if not isinstance(report.get(field), str) or not report[field].strip():
            issues.append(f"camera interaction report requires {field}")
    errors = report.get("pageErrors")
    if not isinstance(errors, list) or errors:
        issues.append("camera interaction pageErrors must be an empty list for PASS")

    tested_artifact = _check_file_record(base, report.get("testedArtifact"), "camera interaction testedArtifact", issues)
    if tested_artifact:
        if Path(tested_artifact[0]).suffix.lower() not in {".html", ".htm"}:
            issues.append("camera interaction testedArtifact must be the actual delivered HTML page")
        if not any(
            isinstance(item, dict) and item.get("path") == tested_artifact[0] and item.get("sha256") == tested_artifact[1]
            for item in evidence
        ):
            issues.append("cameraMotion evidence must include the exact testedArtifact source and SHA-256")

    bounds = contract.get("bounds") if contract.get("mode") == "interactive-orbit" else None
    if not isinstance(bounds, dict):
        issues.append("camera interaction requires an interactive-orbit camera contract with bounds")
        return
    normalized: dict[str, tuple[float, float]] = {}
    for field in ("azimuthDeg", "polarDeg", "distance"):
        pair = bounds.get(field)
        if not isinstance(pair, list) or len(pair) != 2 or any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) for value in pair) or pair[0] >= pair[1]:
            issues.append(f"camera interaction requires ordered bounds.{field}")
        else:
            normalized[field] = (float(pair[0]), float(pair[1]))
    if len(normalized) != 3:
        return

    captures = report.get("captures")
    required_ids = {"initial", "afterOrbit", "afterZoom", "afterReset"}
    capture_by_id: dict[str, dict[str, Any]] = {}
    if not isinstance(captures, list):
        issues.append("camera interaction captures must list initial/orbit/zoom/reset screenshots")
        captures = []
    for index, capture in enumerate(captures):
        label = f"cameraInteraction.captures[{index}]"
        if not isinstance(capture, dict) or not isinstance(capture.get("id"), str) or not capture["id"].strip():
            issues.append(f"{label}.id must be a stable capture identifier")
            continue
        capture_id = capture["id"]
        if capture_id in capture_by_id:
            issues.append(f"camera interaction has duplicate capture id {capture_id}")
        capture_by_id[capture_id] = capture
        record = _check_file_record(base, capture, label, issues)
        if record:
            rel, digest = record
            if not any(isinstance(item, dict) and item.get("path") == rel and item.get("sha256") == digest for item in evidence):
                issues.append(f"{label} must be hashed in cameraMotion evidence")
            _check_capture_png(base, rel, label, issues)
        state = capture.get("state")
        if not isinstance(state, dict) or state.get("settled") is not True:
            issues.append(f"{label}.state must record a settled camera state")
            continue
        for field in ("azimuthDeg", "polarDeg", "distance"):
            value = state.get(field)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                issues.append(f"{label}.state requires finite {field}")
                continue
            lower, upper = normalized[field]
            if field == "azimuthDeg":
                full_circle = upper - lower >= 359.0
                equivalent_in_bounds = any(lower - 1.0 <= value + 360.0 * turn <= upper + 1.0 for turn in range(-2, 3))
                if not full_circle and not equivalent_in_bounds:
                    issues.append(f"{label}.state.{field} lies outside the declared camera bounds")
            elif not lower <= value <= upper:
                issues.append(f"{label}.state.{field} lies outside the declared camera bounds")
    if set(capture_by_id) != required_ids:
        issues.append("camera interaction captures must cover exactly initial, afterOrbit, afterZoom, and afterReset")
    if not required_ids.issubset(capture_by_id):
        return
    def angle_gap(a: Any, b: Any) -> float:
        if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
            return math.inf
        return abs((float(a) - float(b) + 180.0) % 360.0 - 180.0)

    actions = report.get("actions")
    action_types = {item.get("type") for item in actions if isinstance(item, dict) and isinstance(item.get("type"), str)} if isinstance(actions, list) else set()
    if action_types != {"orbit", "zoom", "reset"}:
        issues.append("camera interaction actions must declare orbit, zoom, and reset exactly")
    if not isinstance(actions, list) or len(actions) != 3 or any(not isinstance(item, dict) or not isinstance(item.get("input"), str) or not item["input"].strip() for item in actions):
        issues.append("camera interaction actions must each name the real input used")
    orbit = next((item for item in actions if isinstance(item, dict) and item.get("type") == "orbit"), {}) if isinstance(actions, list) else {}
    travel = orbit.get("travelDegrees")
    trace = orbit.get("azimuthTraceDeg")
    if not isinstance(trace, list) or len(trace) < 3 or any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) for value in trace):
        issues.append("camera interaction orbit must include at least three finite read-back azimuths from the actual drag")
        computed_travel = 0.0
    else:
        computed_travel = sum(abs(float(right) - float(left)) for left, right in zip(trace, trace[1:]))
        if computed_travel < 359.0:
            issues.append("camera interaction azimuthTraceDeg must prove at least 359 degrees of actual input travel")
        if angle_gap(trace[0], trace[-1]) > 2.0:
            issues.append("camera interaction azimuthTraceDeg must end near its starting direction after a full orbit")
    if not isinstance(travel, (int, float)) or isinstance(travel, bool) or not math.isfinite(travel) or abs(float(travel) - computed_travel) > 1.0:
        issues.append("camera interaction travelDegrees must reconcile with the read-back azimuth trace")

    initial = capture_by_id["initial"].get("state", {})
    after_orbit = capture_by_id["afterOrbit"].get("state", {})
    after_zoom = capture_by_id["afterZoom"].get("state", {})
    after_reset = capture_by_id["afterReset"].get("state", {})
    if angle_gap(initial.get("azimuthDeg"), after_orbit.get("azimuthDeg")) > 2.0:
        issues.append("camera interaction afterOrbit must complete a near-full horizontal rotation and return to the initial azimuth")
    start_distance, orbit_distance = initial.get("distance"), after_orbit.get("distance")
    if isinstance(start_distance, (int, float)) and isinstance(orbit_distance, (int, float)) and abs(start_distance - orbit_distance) > max(0.02, abs(start_distance) * 0.02):
        issues.append("camera interaction afterOrbit must preserve zoom distance during the horizontal orbit check")
    zoom_distance, after_zoom_distance = after_orbit.get("distance"), after_zoom.get("distance")
    if isinstance(zoom_distance, (int, float)) and isinstance(after_zoom_distance, (int, float)) and abs(zoom_distance - after_zoom_distance) <= max(0.02, abs(zoom_distance) * 0.01):
        issues.append("camera interaction zoom action must visibly change camera distance")
    if angle_gap(initial.get("azimuthDeg"), after_reset.get("azimuthDeg")) > 1.0 or angle_gap(initial.get("polarDeg"), after_reset.get("polarDeg")) > 1.0:
        issues.append("camera interaction reset must restore initial azimuth and polar angle within 1 degree")
    start_distance, reset_distance = initial.get("distance"), after_reset.get("distance")
    if isinstance(start_distance, (int, float)) and isinstance(reset_distance, (int, float)) and abs(start_distance - reset_distance) > max(0.02, abs(start_distance) * 0.01):
        issues.append("camera interaction reset must restore initial distance within 1 percent or 0.02 units")


def _validate_visual_review(base: Path, record: Any, build_id: str, capture_ids: set[str], camera_mode: str, issues: list[str]) -> None:
    if not isinstance(record, str) or not record.strip():
        issues.append("visualReview: full-production requires visualReviewReport path")
        return
    path = _resolve(base, record)
    report = _load_json(path) if path else None
    if report is None:
        issues.append("visualReview: visualReviewReport must be an existing JSON file")
        return
    review_status = report.get("status")
    if review_status not in {"PASS", "BLOCK"} or report.get("buildId") != build_id:
        issues.append("visualReview: report must be PASS or BLOCK and match the current buildId")
    if not isinstance(report.get("reviewer"), str) or not report["reviewer"].strip():
        issues.append("visualReview: report requires a reviewer")
    reviewed = report.get("reviewedSampleIds")
    reviewed_ids = {sample for sample in reviewed if isinstance(sample, str)} if isinstance(reviewed, list) else set()
    if not isinstance(reviewed, list) or len(reviewed_ids) != len(reviewed) or reviewed_ids != capture_ids:
        issues.append("visualReview: reviewedSampleIds must match every runtime capture exactly")
    findings = report.get("findings")
    if not isinstance(findings, list):
        issues.append("visualReview: findings must be a list, including an empty list when there are no findings")
        findings = []
    finding_by_id: dict[str, dict[str, Any]] = {}
    open_findings: set[str] = set()
    allowed_findings = set(REVIEW_DIMENSIONS) | set(ASSET_INTEGRITY_CHECKS)
    allowed_owners = set(PIPELINE) - {"visualReview"} | {"direction"}
    for index, finding in enumerate(findings):
        if not isinstance(finding, dict):
            issues.append(f"visualReview: findings[{index}] must be an object")
            continue
        finding_id = finding.get("id")
        if not isinstance(finding_id, str) or not finding_id.strip():
            issues.append(f"visualReview: findings[{index}] requires an id")
            continue
        if finding_id in finding_by_id:
            issues.append(f"visualReview: duplicate finding id {finding_id}")
        finding_by_id[finding_id] = finding
        status = finding.get("status")
        if status not in {"OPEN", "RESOLVED"}:
            issues.append(f"visualReview: finding {finding_id} status must be OPEN or RESOLVED")
        if status == "OPEN":
            open_findings.add(finding_id)
        if finding.get("severity") not in {"BLOCKER", "MAJOR", "MINOR"}:
            issues.append(f"visualReview: finding {finding_id} requires BLOCKER, MAJOR, or MINOR severity")
        if finding.get("scope") not in {"scene", "family", "feature"}:
            issues.append(f"visualReview: finding {finding_id} scope must be scene, family, or feature")
        if finding.get("dimension") not in allowed_findings:
            issues.append(f"visualReview: finding {finding_id} has an unknown dimension")
        elif finding.get("dimension") not in REVIEW_DIMENSIONS and finding.get("scope") == "scene":
            issues.append(f"visualReview: scene finding {finding_id} must use a global review dimension")
        if finding.get("scope") in {"family", "feature"} and (not isinstance(finding.get("familyId"), str) or not finding["familyId"].strip()):
            issues.append(f"visualReview: finding {finding_id} requires familyId for family/feature scope")
        if finding.get("scope") == "feature" and (not isinstance(finding.get("featureId"), str) or not finding["featureId"].strip()):
            issues.append(f"visualReview: feature finding {finding_id} requires featureId")
        for key in ("observation", "rootCause", "action"):
            if not isinstance(finding.get(key), str) or len(finding[key].strip()) < 16:
                issues.append(f"visualReview: finding {finding_id} requires a concrete {key}")
        if finding.get("rootCauseStatus") not in {"CONFIRMED", "UNCONFIRMED"}:
            issues.append(f"visualReview: finding {finding_id} rootCauseStatus must be CONFIRMED or UNCONFIRMED")
        if finding.get("rootCauseStatus") == "UNCONFIRMED" and not isinstance(finding.get("action"), str):
            issues.append(f"visualReview: unconfirmed finding {finding_id} requires an investigation action")
        if finding.get("ownerStage") not in allowed_owners:
            issues.append(f"visualReview: finding {finding_id} requires a responsible production stage")
        sample_ids = finding.get("sampleIds")
        if not isinstance(sample_ids, list) or not sample_ids or any(not isinstance(sample, str) for sample in sample_ids) or not set(sample_ids).issubset(capture_ids):
            issues.append(f"visualReview: finding {finding_id} requires evidence sampleIds from runtime captures")
        if status == "RESOLVED":
            resolution = finding.get("resolution")
            if not isinstance(resolution, dict) or resolution.get("buildId") != build_id:
                issues.append(f"visualReview: resolved finding {finding_id} requires a resolution for the current buildId")
            else:
                after_ids = resolution.get("sampleIds")
                if not isinstance(after_ids, list) or not after_ids or any(not isinstance(sample, str) for sample in after_ids) or not set(after_ids).issubset(capture_ids):
                    issues.append(f"visualReview: resolved finding {finding_id} requires current-build resolution sampleIds")
                for key in ("change", "observation"):
                    if not isinstance(resolution.get(key), str) or len(resolution[key].strip()) < 16:
                        issues.append(f"visualReview: resolved finding {finding_id} requires a concrete resolution {key}")
            if finding.get("rootCauseStatus") != "CONFIRMED":
                issues.append(f"visualReview: resolved finding {finding_id} requires a confirmed root cause")
    if review_status == "PASS" and open_findings:
        issues.append("visualReview: PASS cannot contain OPEN visual findings")
    if review_status == "BLOCK" and not open_findings:
        issues.append("visualReview: BLOCK requires at least one OPEN visual finding")
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
            if status not in {"PASS", "NOT_APPLICABLE", "BLOCK"} or (status == "BLOCK" and review_status != "BLOCK"):
                issues.append(f"visualReview: {dimension} must PASS, NOT_APPLICABLE, or BLOCK only when the report is blocked")
            if status in {"PASS", "BLOCK"} and (not isinstance(check.get("observation"), str) or not check["observation"].strip()):
                issues.append(f"visualReview: {dimension} {status} requires a concrete observation")
            if status == "PASS":
                sample_ids = check.get("sampleIds")
                if not isinstance(sample_ids, list) or not sample_ids or any(not isinstance(sample, str) for sample in sample_ids) or not set(sample_ids).issubset(capture_ids):
                    issues.append(f"visualReview: {dimension} PASS requires sampleIds from runtime captures")
            if status == "BLOCK":
                finding_ids = check.get("findingIds")
                if not isinstance(finding_ids, list) or not finding_ids or any(not isinstance(finding_id, str) or finding_id not in finding_by_id or finding_by_id[finding_id].get("dimension") != dimension for finding_id in finding_ids):
                    issues.append(f"visualReview: {dimension} BLOCK requires findingIds linked to findings of that dimension")
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
    review_status = review.get("status")
    findings = review.get("findings", [])
    finding_by_id = {item.get("id"): item for item in findings if isinstance(item, dict) and isinstance(item.get("id"), str)} if isinstance(findings, list) else {}
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
        family_sample_ids = {sample for sample in samples if isinstance(sample, str)} if isinstance(samples, list) else set()
        family_open = [finding for finding in finding_by_id.values() if finding.get("familyId") == family_id and finding.get("status") == "OPEN"]
        if record.get("status") == "BLOCK":
            if review_status != "BLOCK" or not family_open:
                issues.append(f"visualReview: family {family_id} BLOCK requires an OPEN family finding in a BLOCK report")
        elif record.get("status") != "PASS":
            issues.append(f"visualReview: family {family_id} must PASS or be explicitly BLOCK")
        elif family_open:
            issues.append(f"visualReview: family {family_id} PASS cannot contain OPEN findings")
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
            check_status = check.get("status")
            if check_status == "BLOCK":
                if not isinstance(check.get("observation"), str) or not check["observation"].strip():
                    issues.append(f"visualReview: family {family_id} {dimension} BLOCK requires a concrete observation")
                finding_ids = check.get("findingIds")
                linked = isinstance(finding_ids, list) and bool(finding_ids) and all(
                    isinstance(finding_id, str) and finding_id in finding_by_id
                    and finding_by_id[finding_id].get("familyId") == family_id
                    and finding_by_id[finding_id].get("dimension") == dimension
                    for finding_id in finding_ids
                )
                if review_status != "BLOCK" or record.get("status") != "BLOCK" or not linked:
                    issues.append(f"visualReview: family {family_id} {dimension} BLOCK requires linked findingIds in a BLOCK report")
            elif check_status != "PASS" or not isinstance(check.get("observation"), str) or not check["observation"].strip():
                issues.append(f"visualReview: family {family_id} {dimension} requires PASS with a concrete observation")
            sample_ids = check.get("sampleIds")
            if not isinstance(sample_ids, list) or not sample_ids or any(not isinstance(sample, str) for sample in sample_ids) or not set(sample_ids).issubset(family_sample_ids & capture_ids):
                issues.append(f"visualReview: family {family_id} {dimension} requires sampleIds from this family's reviewed runtime captures")
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
            if feature_review.get("status") == "BLOCK":
                if not isinstance(feature_review.get("observation"), str) or len(feature_review["observation"].strip()) < 20:
                    issues.append(f"visualReview: family {family_id} feature {feature_id} BLOCK requires a concrete observation")
                finding_ids = feature_review.get("findingIds")
                linked = isinstance(finding_ids, list) and bool(finding_ids) and all(
                    isinstance(finding_id, str) and finding_id in finding_by_id
                    and finding_by_id[finding_id].get("familyId") == family_id
                    and finding_by_id[finding_id].get("featureId") == feature_id
                    for finding_id in finding_ids
                )
                if review_status != "BLOCK" or record.get("status") != "BLOCK" or not linked:
                    issues.append(f"visualReview: family {family_id} feature {feature_id} BLOCK requires linked findingIds in a BLOCK report")
            elif feature_review.get("status") != "PASS" or not isinstance(feature_review.get("observation"), str) or len(feature_review["observation"].strip()) < 20:
                issues.append(f"visualReview: family {family_id} feature {feature_id} requires PASS with a concrete observation")
            if not isinstance(sample_ids, list) or not sample_ids or any(not isinstance(sample, str) for sample in sample_ids) or not set(sample_ids).issubset(family_sample_ids & capture_ids):
                issues.append(f"visualReview: family {family_id} feature {feature_id} needs capture evidence from this family's reviewed runtime views")


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


def _finite_vec3(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 3 and all(
        isinstance(component, (int, float)) and math.isfinite(component) for component in value
    )


def _object_bounds_contains(obj: dict[str, Any], point: list[float]) -> bool:
    anchor = obj.get("anchor", {}).get("xyz") if isinstance(obj.get("anchor"), dict) else None
    size = obj.get("bounds", {}).get("size") if isinstance(obj.get("bounds"), dict) else None
    return _finite_vec3(anchor) and _finite_vec3(size) and all(
        anchor[axis] - size[axis] / 2 - 0.02 <= point[axis] <= anchor[axis] + size[axis] / 2 + 0.02
        for axis in range(3)
    )


def _object_vertical_contains(obj: Any, y: float) -> bool:
    if not isinstance(obj, dict):
        return False
    low, high = obj.get("baseY"), obj.get("topY")
    return isinstance(low, (int, float)) and isinstance(high, (int, float)) and low - 0.02 <= y <= high + 0.02


def _registered_plan_shape(obj: Any, shape_id: Any) -> dict[str, Any] | None:
    if not isinstance(obj, dict) or not isinstance(shape_id, str):
        return None
    shapes = obj.get("planGeometry")
    if not isinstance(shapes, list):
        return None
    return next((item for item in shapes if isinstance(item, dict) and item.get("id") == shape_id), None)


def _shape_contains_placement(shape: dict[str, Any], point: list[float]) -> bool:
    if not point_in_plan_shape_xz([point[0], point[2]], shape):
        return False
    elevation = shape.get("elevationY")
    if isinstance(elevation, (int, float)) and abs(point[1] - elevation) > 0.02:
        return False
    span = shape.get("elevationRangeY")
    if isinstance(span, list) and len(span) == 2 and all(isinstance(value, (int, float)) for value in span):
        if not span[0] - 0.02 <= point[1] <= span[1] + 0.02:
            return False
    return True


def _distribution_placement_rows(base: Path, group: dict[str, Any], label: str, evidence: Any, issues: list[str]):
    table = group.get("placementTable")
    if table is None:
        placements = group.get("placements")
        if not isinstance(placements, list):
            issues.append(f"{label}.placements must be a list or use placementTable CSV")
            return iter(())
        return iter(placements)
    if group.get("placements") not in (None, []):
        issues.append(f"{label} must use either placements or placementTable, not both")
    record = _check_file_record(base, table, f"{label}.placementTable", issues)
    if not record:
        return iter(())
    relative, digest = record
    if Path(relative).suffix.lower() != ".csv":
        issues.append(f"{label}.placementTable must be a CSV file")
    if not any(isinstance(item, dict) and item.get("path") == relative and item.get("sha256") == digest for item in evidence):
        issues.append(f"{label}.placementTable must be hashed in detailDistribution evidence")
    path = _resolve(base, relative)
    required_columns = {"id", "zoneId", "variantId", "x", "y", "z", "sx", "sy", "sz"}

    def rows():
        try:
            with path.open(newline="", encoding="utf-8") as stream:
                reader = csv.DictReader(stream)
                if not required_columns.issubset(set(reader.fieldnames or [])):
                    issues.append(f"{label}.placementTable requires columns: " + ", ".join(sorted(required_columns)))
                    return
                for index, row in enumerate(reader):
                    def number(field: str):
                        try:
                            return float(row.get(field, ""))
                        except (TypeError, ValueError):
                            return None
                    yield {
                        "id": row.get("id"), "zoneId": row.get("zoneId"), "variantId": row.get("variantId"),
                        "positionWorld": [number("x"), number("y"), number("z")],
                        "scale": [number("sx"), number("sy"), number("sz")],
                    }
        except (OSError, UnicodeDecodeError, csv.Error) as exc:
            issues.append(f"{label}.placementTable could not be read: {exc}")

    return rows()


def validate_distribution_report(
    base: Path, report_path: Any, register_path: Any, visual_build_map_path: Any,
    asset_ledger_path: Any, stage: Any, issues: list[str],
) -> None:
    """Check planned and realized detail placements against declared zones and visual evidence."""
    report_file = _resolve(base, report_path)
    register_file = _resolve(base, register_path)
    build_map_file = _resolve(base, visual_build_map_path)
    ledger_file = _resolve(base, asset_ledger_path)
    if report_file is None:
        issues.append("distributionReportPath must reference an existing project JSON file")
        return
    if not register_file or not build_map_file or not ledger_file:
        issues.append("detailDistribution requires scene register, visual build map, and asset ledger inputs")
        return
    stage = stage if isinstance(stage, dict) else {}
    evidence = stage.get("evidence", [])
    report_hash = _hash(report_file)
    if not any(isinstance(item, dict) and item.get("path") == report_path and item.get("sha256") == report_hash for item in evidence):
        issues.append("detailDistribution evidence must include distributionReportPath with its SHA-256")
    upstream_refs = {
        str(register_path): _hash(register_file),
        str(visual_build_map_path): _hash(build_map_file),
        str(asset_ledger_path): _hash(ledger_file),
    }
    recorded_inputs = {
        (item.get("path"), item.get("sha256"))
        for item in stage.get("inputs", []) if isinstance(item, dict)
    }
    for path, digest in upstream_refs.items():
        if (path, digest) not in recorded_inputs:
            issues.append(f"detailDistribution inputs must include {path} with its current SHA-256")
    report, register, build_map, ledger = (
        _load_json(report_file), _load_json(register_file), _load_json(build_map_file), _load_json(ledger_file)
    )
    if not all((report, register, build_map, ledger)):
        issues.append("distribution report and its upstream design artifacts must be readable JSON objects")
        return
    if report.get("schemaVersion") != 1:
        issues.append("distribution report schemaVersion must equal 1")
    if report.get("status") != "PASS" or report.get("buildId") != stage.get("buildId"):
        issues.append("distribution report must PASS and match the detailDistribution stage buildId")

    objects = {item.get("id"): item for item in register.get("objects", []) if isinstance(item, dict) and isinstance(item.get("id"), str)}
    families = {item.get("id"): item for item in ledger.get("families", []) if isinstance(item, dict) and isinstance(item.get("id"), str)}
    categories: dict[str, str] = {}
    for entry in build_map.get("entries", []):
        if isinstance(entry, dict):
            for feature in entry.get("features", []):
                if isinstance(feature, dict) and isinstance(feature.get("id"), str):
                    categories[feature["id"]] = feature.get("category")
    expected_features = {feature_id for feature_id, category in categories.items() if isinstance(category, str) and category in {"distribution", "detail"}}
    if not expected_features:
        issues.append("visualBuildMap must define at least one distribution/detail feature for full-production")

    groups = report.get("groups")
    if not isinstance(groups, list) or not groups:
        issues.append("distribution report groups must be a nonempty list")
        return
    seen_groups: set[str] = set()
    covered_features: dict[str, str] = {}
    for group_index, group in enumerate(groups):
        label = f"distributionReport.groups[{group_index}]"
        if not isinstance(group, dict):
            issues.append(f"{label} must be an object")
            continue
        group_id, family_id = group.get("id"), group.get("familyId")
        if not isinstance(group_id, str) or not group_id.strip():
            issues.append(f"{label}.id must be a stable identifier")
            continue
        if group_id in seen_groups:
            issues.append(f"distribution report has duplicate group id {group_id}")
        seen_groups.add(group_id)
        family = families.get(family_id) if isinstance(family_id, str) else None
        if family is None:
            issues.append(f"{label}.familyId must resolve to an asset family")
        feature_ids = group.get("featureIds")
        if not isinstance(feature_ids, list) or not feature_ids or any(not isinstance(value, str) for value in feature_ids) or len(feature_ids) != len(set(feature_ids)):
            issues.append(f"{label}.featureIds must list unique mapped features")
            feature_ids = []
        for feature_id in feature_ids:
            if feature_id not in expected_features:
                issues.append(f"{label} feature {feature_id} must be categorized as distribution/detail in visualBuildMap")
            family_features = family.get("visualFeatureIds", []) if isinstance(family, dict) else []
            if family and (not isinstance(family_features, list) or feature_id not in family_features):
                issues.append(f"{label} feature {feature_id} must belong to asset family {family_id}")
            if feature_id in covered_features:
                issues.append(f"distribution feature {feature_id} is covered by multiple groups")
            covered_features[feature_id] = group_id

        method = group.get("method")
        if not isinstance(method, str) or method not in DISTRIBUTION_METHODS:
            issues.append(f"{label}.method must be one of: " + ", ".join(sorted(DISTRIBUTION_METHODS)))
        seed = group.get("seed")
        if method != "manual" and (not isinstance(seed, int) or isinstance(seed, bool)):
            issues.append(f"{label}.seed must be a fixed integer for reproducible non-manual placement")
        source = group.get("placementSource")
        source_record = _check_file_record(base, source, f"{label}.placementSource", issues)
        if source_record:
            source_rel, source_digest = source_record
            if not any(isinstance(item, dict) and item.get("path") == source_rel and item.get("sha256") == source_digest for item in evidence):
                issues.append(f"{label}.placementSource must be hashed in detailDistribution evidence")
            symbol = source.get("symbol") if isinstance(source, dict) else None
            if not isinstance(symbol, str) or not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", symbol):
                issues.append(f"{label}.placementSource.symbol must name one declared generator/placement symbol")
            else:
                source_file = _resolve(base, source_rel)
                try:
                    source_text = source_file.read_text(encoding="utf-8") if source_file else ""
                except (OSError, UnicodeDecodeError):
                    source_text = ""
                declaration = rf"\b(?:function|class)\s+{re.escape(symbol)}\b|\b(?:const|let|var)\s+{re.escape(symbol)}\s*="
                if source_text and not re.search(declaration, source_text):
                    issues.append(f"{label}.placementSource does not declare {symbol}")
        zones = group.get("zones")
        if not isinstance(zones, list) or not zones:
            issues.append(f"{label}.zones must define allowed distribution regions and target counts")
            zones = []
        zone_by_id: dict[str, dict[str, Any]] = {}
        zone_counts: dict[str, int] = {}
        for zone_index, zone in enumerate(zones):
            zone_label = f"{label}.zones[{zone_index}]"
            if not isinstance(zone, dict) or not isinstance(zone.get("id"), str) or not zone["id"].strip():
                issues.append(f"{zone_label}.id must be a stable identifier")
                continue
            zone_id = zone["id"]
            if zone_id in zone_by_id:
                issues.append(f"{label}.zones has duplicate id {zone_id}")
            zone_by_id[zone_id] = zone
            target_range = zone.get("targetCountRange")
            if not isinstance(target_range, list) or len(target_range) != 2 or any(not isinstance(value, int) or isinstance(value, bool) for value in target_range) or target_range[0] < 1 or target_range[1] < target_range[0]:
                issues.append(f"{zone_label}.targetCountRange must be an ordered positive integer pair; intentionally empty regions belong in excludeRegions")
            if not isinstance(zone.get("pattern"), str) or zone.get("pattern") not in DISTRIBUTION_PATTERNS:
                issues.append(f"{zone_label}.pattern must describe the intended spatial rhythm")
            object_id = zone.get("objectId")
            obj = objects.get(object_id) if isinstance(object_id, str) else None
            if obj is None or not isinstance(obj.get("geometryRole"), str) or obj.get("geometryRole") not in {"distribution-envelope", "surface"}:
                issues.append(f"{zone_label}.objectId must resolve to a distribution envelope or host surface")
            shape = None
            if obj and zone.get("planGeometryId"):
                shape = _registered_plan_shape(obj, zone.get("planGeometryId"))
                if shape is None or shape.get("role") not in {"distribution-envelope", "support-footprint", "walkable-surface", "overhead-overhang"}:
                    issues.append(f"{zone_label}.planGeometryId must resolve to an allowed plan region")
            elif obj and (obj.get("geometryRole") != "distribution-envelope" or obj.get("hostSurfaceId")):
                issues.append(f"{zone_label} on a surface-hosted domain requires planGeometryId; a bounding box is not a distribution mask")
            excludes = zone.get("excludeRegions", [])
            if not isinstance(excludes, list):
                issues.append(f"{zone_label}.excludeRegions must be a list")
            else:
                for exclude_index, excluded in enumerate(excludes):
                    if not isinstance(excluded, dict):
                        issues.append(f"{zone_label}.excludeRegions[{exclude_index}] must identify a registered clearance region")
                        continue
                    excluded_object_id = excluded.get("objectId")
                    excluded_obj = objects.get(excluded_object_id) if isinstance(excluded_object_id, str) else None
                    excluded_shape = _registered_plan_shape(excluded_obj, excluded.get("planGeometryId"))
                    if not excluded_obj or not excluded_shape or excluded_shape.get("role") != "clearance-envelope":
                        issues.append(f"{zone_label}.excludeRegions[{exclude_index}] must resolve to a clearance-envelope")

        placements = _distribution_placement_rows(base, group, label, evidence, issues)
        placement_count = 0
        placement_ids: set[str] = set()
        variant_ids: set[str] = set()
        for placement_index, placement in enumerate(placements):
            placement_count += 1
            placement_label = f"{label}.placements[{placement_index}]"
            if not isinstance(placement, dict) or not isinstance(placement.get("id"), str) or not placement["id"].strip():
                issues.append(f"{placement_label}.id must be a stable emitted instance id")
                continue
            if placement["id"] in placement_ids:
                issues.append(f"{label}.placements has duplicate id {placement['id']}")
            placement_ids.add(placement["id"])
            zone_id = placement.get("zoneId")
            zone = zone_by_id.get(zone_id)
            if zone is None:
                issues.append(f"{placement_label}.zoneId must resolve to a declared distribution zone")
                continue
            position, scale, variant = placement.get("positionWorld"), placement.get("scale"), placement.get("variantId")
            if not _finite_vec3(position):
                issues.append(f"{placement_label}.positionWorld must be a finite world-space anchor")
                continue
            if not _finite_vec3(scale) or any(value <= 0 for value in scale):
                issues.append(f"{placement_label}.scale must be a positive finite vec3")
            if not isinstance(variant, str) or not variant.strip():
                issues.append(f"{placement_label}.variantId must name the emitted form variant")
            else:
                variant_ids.add(variant)
            object_id = zone.get("objectId")
            obj = objects.get(object_id) if isinstance(object_id, str) else None
            shape = _registered_plan_shape(obj, zone.get("planGeometryId"))
            if shape:
                if not _shape_contains_placement(shape, position):
                    issues.append(f"{placement_label} lies outside or inside a hole of declared plan region {zone_id}")
                host_id = obj.get("hostSurfaceId") if isinstance(obj, dict) else None
                vertical_host = objects.get(host_id) if isinstance(host_id, str) else obj
                if not _object_vertical_contains(vertical_host, position[1]):
                    issues.append(f"{placement_label} lies outside the registered host elevation range for {zone_id}")
            elif obj and not _object_bounds_contains(obj, position):
                issues.append(f"{placement_label} lies outside declared distribution bounds {zone_id}")
            for excluded in zone.get("excludeRegions", []) if isinstance(zone.get("excludeRegions", []), list) else []:
                if not isinstance(excluded, dict):
                    continue
                excluded_object_id = excluded.get("objectId")
                excluded_obj = objects.get(excluded_object_id) if isinstance(excluded_object_id, str) else None
                excluded_shape = _registered_plan_shape(excluded_obj, excluded.get("planGeometryId"))
                if excluded_shape and _shape_contains_placement(excluded_shape, position):
                    issues.append(f"{placement_label} lies inside excluded clearance region {excluded.get('planGeometryId')}")
            zone_counts[zone_id] = zone_counts.get(zone_id, 0) + 1

        counts = group.get("counts")
        if not isinstance(counts, dict):
            issues.append(f"{label}.counts must reconcile candidate, accepted, and rejection totals")
            counts = {}
        candidates, accepted, rejected = counts.get("candidate"), counts.get("accepted"), counts.get("rejectedByReason")
        if not isinstance(candidates, int) or isinstance(candidates, bool) or not isinstance(accepted, int) or isinstance(accepted, bool) or candidates < 0 or accepted != placement_count or accepted > candidates:
            issues.append(f"{label}.counts candidate/accepted must match the actual placement list")
        if not isinstance(rejected, dict) or any(not isinstance(reason, str) or not reason.strip() or not isinstance(value, int) or isinstance(value, bool) or value < 0 for reason, value in rejected.items()):
            issues.append(f"{label}.counts.rejectedByReason must contain nonnegative reason counts")
        elif isinstance(candidates, int) and isinstance(accepted, int) and accepted + sum(rejected.values()) != candidates:
            issues.append(f"{label}.counts rejectedByReason must reconcile candidate minus accepted")
        for zone_id, zone in zone_by_id.items():
            target = zone.get("targetCountRange")
            if isinstance(target, list) and len(target) == 2 and all(isinstance(value, int) and not isinstance(value, bool) for value in target):
                actual = zone_counts.get(zone_id, 0)
                if not target[0] <= actual <= target[1]:
                    issues.append(f"{label} zone {zone_id} has {actual} placements outside targetCountRange {target}")
        minimum_variants = group.get("minimumVariantCount")
        if not isinstance(minimum_variants, int) or isinstance(minimum_variants, bool) or minimum_variants < 1 or len(variant_ids) < minimum_variants:
            issues.append(f"{label}.minimumVariantCount must be met by actual placement variantIds")

        views = group.get("views")
        if not isinstance(views, list):
            issues.append(f"{label}.views must contain context, distribution-map, and detail PNG evidence")
            views = []
        view_ids: set[str] = set()
        role_by_view: dict[str, str] = {}
        for view_index, view in enumerate(views):
            view_label = f"{label}.views[{view_index}]"
            if not isinstance(view, dict) or not isinstance(view.get("id"), str) or not view["id"].strip():
                issues.append(f"{view_label}.id must be a stable view identifier")
                continue
            view_id, role = view["id"], view.get("role")
            if view_id in view_ids:
                issues.append(f"{label}.views has duplicate id {view_id}")
            view_ids.add(view_id)
            if not isinstance(role, str) or role not in DISTRIBUTION_VIEW_ROLES:
                issues.append(f"{view_label}.role must be one of: " + ", ".join(sorted(DISTRIBUTION_VIEW_ROLES)))
            else:
                role_by_view[view_id] = role
            capture = _check_file_record(base, view, view_label, issues)
            if capture:
                rel, digest = capture
                if not any(isinstance(item, dict) and item.get("path") == rel and item.get("sha256") == digest for item in evidence):
                    issues.append(f"{view_label} must be hashed in detailDistribution evidence")
                _check_capture_png(base, rel, view_label, issues)
        if not DISTRIBUTION_VIEW_ROLES.issubset(set(role_by_view.values())):
            issues.append(f"{label}.views must include each required role: " + ", ".join(sorted(DISTRIBUTION_VIEW_ROLES)))

        checks = group.get("checks")
        if not isinstance(checks, list):
            issues.append(f"{label}.checks must inspect each distribution quality dimension")
            continue
        checks_by_dimension: dict[str, dict[str, Any]] = {}
        for check in checks:
            if isinstance(check, dict) and isinstance(check.get("dimension"), str):
                dimension = check["dimension"]
                if dimension in checks_by_dimension:
                    issues.append(f"{label}.checks has duplicate dimension {dimension}")
                checks_by_dimension[dimension] = check
        if set(checks_by_dimension) != DISTRIBUTION_CHECKS:
            issues.append(f"{label}.checks must cover exactly: " + ", ".join(sorted(DISTRIBUTION_CHECKS)))
        required_roles_by_dimension = {
            "coverage": {"context", "distribution-map"},
            "spacing-rhythm": {"distribution-map"},
            "variation": {"detail"},
            "screen-scale": {"context", "detail"},
            "support-clearance": {"context"},
        }
        for dimension in DISTRIBUTION_CHECKS & set(checks_by_dimension):
            check = checks_by_dimension[dimension]
            status = check.get("status")
            if status == "PASS":
                observation = check.get("observation")
                if not isinstance(observation, str) or len(observation.strip()) < 20:
                    issues.append(f"{label} {dimension} PASS requires a concrete visual observation")
                linked = check.get("viewIds")
                if not isinstance(linked, list) or not linked or any(not isinstance(value, str) for value in linked) or not set(linked).issubset(view_ids):
                    issues.append(f"{label} {dimension} requires viewIds linked to its PNG evidence")
                elif not required_roles_by_dimension[dimension].issubset({role_by_view.get(view_id) for view_id in linked}):
                    issues.append(f"{label} {dimension} must cite views with roles: " + ", ".join(sorted(required_roles_by_dimension[dimension])))
            elif status == "NOT_APPLICABLE":
                if dimension not in {"spacing-rhythm", "variation"} or not isinstance(check.get("reason"), str) or len(check["reason"].strip()) < 20:
                    issues.append(f"{label} {dimension} NOT_APPLICABLE needs a justified single-form reason")
            else:
                issues.append(f"{label} {dimension} must PASS or be explicitly NOT_APPLICABLE")

    if set(covered_features) != expected_features:
        missing = sorted(expected_features - set(covered_features))
        extra = sorted(set(covered_features) - expected_features)
        if missing:
            issues.append("distribution report is missing mapped distribution/detail features: " + ", ".join(missing))
        if extra:
            issues.append("distribution report includes unmapped distribution/detail features: " + ", ".join(extra))


def validate_lookdev_report(
    base: Path, report_path: Any, register_path: Any, visual_build_map_path: Any,
    asset_ledger_path: Any, stage: Any, issues: list[str],
) -> None:
    """Check traceable, paired material/light calibration evidence for mapped material features."""
    report_file = _resolve(base, report_path)
    register_file = _resolve(base, register_path)
    build_map_file = _resolve(base, visual_build_map_path)
    ledger_file = _resolve(base, asset_ledger_path)
    if report_file is None:
        issues.append("lookdevReportPath must reference an existing project JSON file")
        return
    if not register_file or not build_map_file or not ledger_file:
        issues.append("lookdev requires scene register, visual build map, and asset ledger inputs")
        return
    stage = stage if isinstance(stage, dict) else {}
    evidence = stage.get("evidence", [])
    report_hash = _hash(report_file)
    if not any(isinstance(item, dict) and item.get("path") == report_path and item.get("sha256") == report_hash for item in evidence):
        issues.append("lookdev evidence must include lookdevReportPath with its SHA-256")
    upstream_refs = {
        str(register_path): _hash(register_file),
        str(visual_build_map_path): _hash(build_map_file),
        str(asset_ledger_path): _hash(ledger_file),
    }
    recorded_inputs = {
        (item.get("path"), item.get("sha256"))
        for item in stage.get("inputs", []) if isinstance(item, dict)
    }
    for path, digest in upstream_refs.items():
        if (path, digest) not in recorded_inputs:
            issues.append(f"lookdev inputs must include {path} with its current SHA-256")
    report, _register, build_map, ledger = (
        _load_json(report_file), _load_json(register_file), _load_json(build_map_file), _load_json(ledger_file)
    )
    if not all((report, _register, build_map, ledger)):
        issues.append("lookdev report and its upstream design artifacts must be readable JSON objects")
        return
    if report.get("schemaVersion") != 1:
        issues.append("lookdev report schemaVersion must equal 1")
    if report.get("status") != "PASS" or report.get("buildId") != stage.get("buildId"):
        issues.append("lookdev report must PASS and match the lookdev stage buildId")

    feature_family: dict[str, str] = {}
    valid_families: set[str] = set()
    for family in ledger.get("families", []):
        if isinstance(family, dict) and isinstance(family.get("id"), str):
            valid_families.add(family["id"])
            for feature_id in family.get("visualFeatureIds", []):
                if isinstance(feature_id, str):
                    feature_family[feature_id] = family["id"]
    material_features: set[str] = set()
    feature_owner: dict[str, str | None] = {}
    for entry in build_map.get("entries", []):
        if not isinstance(entry, dict):
            continue
        for feature in entry.get("features", []):
            if isinstance(feature, dict) and isinstance(feature.get("id"), str) and feature.get("category") == "material":
                feature_id = feature["id"]
                material_features.add(feature_id)
                feature_owner[feature_id] = feature_family.get(feature_id)
    if not material_features:
        issues.append("visualBuildMap must define material features for full-production lookdev")

    groups = report.get("groups")
    if not isinstance(groups, list) or not groups:
        issues.append("lookdev report groups must be a nonempty list")
        return
    seen_groups: set[str] = set()
    covered: dict[str, str] = {}
    family_to_group: dict[str, str] = {}
    for index, group in enumerate(groups):
        label = f"lookdevReport.groups[{index}]"
        if not isinstance(group, dict):
            issues.append(f"{label} must be an object")
            continue
        group_id = group.get("id")
        family_id = group.get("familyId")
        if not isinstance(group_id, str) or not group_id.strip() or group_id in seen_groups:
            issues.append(f"{label}.id must be a unique stable identifier")
            continue
        seen_groups.add(group_id)
        if not isinstance(family_id, str) or family_id not in valid_families:
            issues.append(f"{label}.familyId must resolve to an asset family")
        feature_ids = group.get("featureIds")
        if not isinstance(feature_ids, list) or not feature_ids or any(not isinstance(value, str) for value in feature_ids) or len(feature_ids) != len(set(feature_ids)):
            issues.append(f"{label}.featureIds must list unique material features")
            feature_ids = []
        if isinstance(family_id, str) and family_id in family_to_group and family_to_group[family_id] != group_id:
            issues.append(f"lookdev asset family {family_id} is split across groups; consolidate its fixed-view calibration")
        if isinstance(family_id, str):
            family_to_group[family_id] = group_id
        for feature_id in feature_ids:
            if feature_id not in material_features:
                issues.append(f"{label} feature {feature_id} must be categorized as material in visualBuildMap")
            if feature_owner.get(feature_id) != family_id:
                issues.append(f"{label} feature {feature_id} must belong to asset family {family_id}")
            if feature_id in covered:
                issues.append(f"lookdev material feature {feature_id} is covered by multiple groups")
            covered[feature_id] = group_id

        sources = group.get("sources")
        source_roles: set[str] = set()
        if not isinstance(sources, list) or not sources:
            issues.append(f"{label}.sources must trace material, lighting, and render-output consumers")
            sources = []
        for source_index, source in enumerate(sources):
            source_label = f"{label}.sources[{source_index}]"
            source_record = _check_file_record(base, source, source_label, issues)
            if source_record:
                rel, digest = source_record
                if not any(isinstance(item, dict) and item.get("path") == rel and item.get("sha256") == digest for item in evidence):
                    issues.append(f"{source_label} must be hashed in lookdev evidence")
            role = source.get("role") if isinstance(source, dict) else None
            symbol = source.get("symbol") if isinstance(source, dict) else None
            if not isinstance(role, str) or role not in LOOKDEV_SOURCE_ROLES:
                issues.append(f"{source_label}.role must be one of: " + ", ".join(sorted(LOOKDEV_SOURCE_ROLES)))
            else:
                source_roles.add(role)
            if not isinstance(symbol, str) or not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", symbol):
                issues.append(f"{source_label}.symbol must name a declared implementation symbol")
            elif source_record:
                source_file = _resolve(base, source_record[0])
                try:
                    source_text = source_file.read_text(encoding="utf-8") if source_file else ""
                except (OSError, UnicodeDecodeError):
                    source_text = ""
                declaration = rf"\b(?:function|class)\s+{re.escape(symbol)}\b|\b(?:const|let|var)\s+{re.escape(symbol)}\s*="
                if source_text and not re.search(declaration, source_text):
                    issues.append(f"{source_label} source does not declare {symbol}")
        if "material-binding" not in source_roles or not source_roles.intersection({"lighting", "render-output"}):
            issues.append(f"{label}.sources must trace material-binding and at least one lighting/render-output consumer")

        target = group.get("targetResponse")
        if not isinstance(target, str) or len(target.strip()) < 20:
            issues.append(f"{label}.targetResponse must state the intended visible material/light response")
        comparison = group.get("comparison")
        if not isinstance(comparison, dict):
            issues.append(f"{label}.comparison must contain a paired controlled calibration")
            continue
        changed = comparison.get("changedVariable")
        before_value, selected_value = comparison.get("baselineValue"), comparison.get("selectedValue")
        if (not isinstance(changed, str) or len(changed.strip()) < 4
                or before_value in (None, "") or selected_value in (None, "") or before_value == selected_value):
            issues.append(f"{label}.comparison must name a changed variable and distinct baseline/selected values")
        frozen = comparison.get("frozenControls")
        required_controls = {"cameraId", "resolution", "geometryHash", "renderer", "threeVersion", "exposure", "toneMapping", "outputColorSpace"}
        if not isinstance(frozen, dict) or not required_controls.issubset(frozen):
            issues.append(f"{label}.comparison.frozenControls must lock: " + ", ".join(sorted(required_controls)))
        else:
            resolution = frozen.get("resolution")
            if not isinstance(resolution, list) or len(resolution) != 2 or any(not isinstance(value, int) or isinstance(value, bool) or value <= 0 for value in resolution):
                issues.append(f"{label}.comparison.frozenControls.resolution must be two positive integers")
            geometry_hash = frozen.get("geometryHash")
            if not isinstance(geometry_hash, str) or not SHA256_RE.fullmatch(geometry_hash):
                issues.append(f"{label}.comparison.frozenControls.geometryHash must be a SHA-256 of the fixed geometry/layout state")
            for key in ("cameraId", "renderer", "threeVersion", "toneMapping", "outputColorSpace"):
                if not isinstance(frozen.get(key), str) or not frozen[key].strip():
                    issues.append(f"{label}.comparison.frozenControls.{key} must be a nonempty string")
            exposure = frozen.get("exposure")
            if not isinstance(exposure, (int, float)) or isinstance(exposure, bool) or not math.isfinite(exposure):
                issues.append(f"{label}.comparison.frozenControls.exposure must be finite")
        for side in ("baseline", "selected"):
            capture = comparison.get(side)
            capture_label = f"{label}.comparison.{side}"
            record = _check_file_record(base, capture, capture_label, issues)
            if record:
                rel, digest = record
                if not any(isinstance(item, dict) and item.get("path") == rel and item.get("sha256") == digest for item in evidence):
                    issues.append(f"{capture_label} must be hashed in lookdev evidence")
                _check_capture_png(base, rel, capture_label, issues)
        decision = group.get("decision")
        if not isinstance(decision, dict) or decision.get("status") != "SELECTED" or not isinstance(decision.get("observation"), str) or len(decision["observation"].strip()) < 20:
            issues.append(f"{label}.decision must explain the selected response with a concrete visual observation")

    missing = material_features - set(covered)
    extra = set(covered) - material_features
    if missing:
        issues.append("lookdev report is missing mapped material features: " + ", ".join(sorted(missing)))
    if extra:
        issues.append("lookdev report includes unmapped material features: " + ", ".join(sorted(extra)))


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

    if "detailDistribution" in required_stages:
        validate_distribution_report(
            base, data.get("distributionReportPath"), data.get("sceneRegisterPath"),
            data.get("visualBuildMapPath"), data.get("assetLedgerPath"),
            by_id.get("detailDistribution", {}), issues,
        )

    if "lookdev" in required_stages:
        validate_lookdev_report(
            base, data.get("lookdevReportPath"), data.get("sceneRegisterPath"),
            data.get("visualBuildMapPath"), data.get("assetLedgerPath"),
            by_id.get("lookdev", {}), issues,
        )

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
        camera_contract_data = _load_json(camera_contract_file) if camera_contract_file else None
        if camera_contract_data and camera_contract_data.get("mode") == "interactive-orbit":
            if camera_stage.get("buildId") != build_id:
                issues.append("cameraMotion buildId must match the final build for interactive-orbit delivery")
            validate_camera_interaction_report(
                base, data.get("cameraInteractionReportPath"), camera_contract_path,
                camera_stage, issues,
            )
        runtime_ids = _validate_runtime_report(base, runtime_stage.get("runtimeReport"), runtime_stage.get("buildId", ""), camera_contract_path, runtime_stage, issues)
        if "visualReview" in required_stages:
            review_stage = by_id.get("visualReview", {})
            _validate_visual_review(base, review_stage.get("visualReviewReport"), review_stage.get("buildId", ""), runtime_ids, camera_contract_data.get("mode", "") if camera_contract_data else "", issues)
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
                        if item["kind"] in {"runnable-html", "offline-html"}:
                            target = _resolve(base, item["path"])
                            if target:
                                _validate_html_deliverable(item["kind"], target, base, issues)
                if not delivered.issubset(stage_outputs.get("delivery", set())):
                    issues.append("delivery stage evidence must hash every final deliverable")
            run_instructions = _check_file_record(base, data.get("runInstructions"), "full-production runInstructions", issues)
            if run_instructions:
                if run_instructions not in delivered:
                    issues.append("runInstructions must be included in final deliverables")
                if run_instructions not in stage_outputs.get("delivery", set()):
                    issues.append("delivery stage evidence must hash runInstructions")
            runtime_report_path = _resolve(base, runtime_stage.get("runtimeReport"))
            runtime_report_data = _load_json(runtime_report_path) if runtime_report_path else None
            runtime_tested = _check_file_record(base, runtime_report_data.get("testedArtifact"), "runtime final testedArtifact", issues) if runtime_report_data and runtime_report_data.get("testedArtifact") else None
            if runtime_tested and runtime_tested not in stage_outputs.get("delivery", set()):
                issues.append("delivery evidence must include the exact HTML page tested by runtime")
            if isinstance(deliverables, list):
                for item in deliverables:
                    if isinstance(item, dict) and item.get("kind") == "mp4":
                        _validate_video_deliverable(base, item, build_id, runtime_tested, stage_outputs.get("delivery", set()), issues)
            camera_contract = _load_json(camera_contract_file) if camera_contract_file else None
            if camera_contract and camera_contract.get("mode") == "interactive-orbit":
                interaction_path = _resolve(base, data.get("cameraInteractionReportPath"))
                interaction = _load_json(interaction_path) if interaction_path else None
                tested = interaction.get("testedArtifact") if interaction else None
                tested_record = _check_file_record(base, tested, "camera interaction final testedArtifact", issues) if tested else None
                if tested_record and tested_record not in delivered:
                    issues.append("camera interaction testedArtifact must match a hashed final HTML deliverable exactly")
                if runtime_tested and tested_record and runtime_tested != tested_record:
                    issues.append("runtime and camera interaction must test the exact same HTML path and SHA-256")
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
