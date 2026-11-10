#!/usr/bin/env python3
"""Regression tests for request-bound interactive camera coverage."""
from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "validate_spatial_gate.py"


def camera_fixture() -> tuple[dict, dict]:
    bounds = {"azimuthDeg": [0, 360], "polarDeg": [30, 150], "distance": [6, 20]}
    samples = []
    for az in range(0, 360, 45):
        samples.append({"id": f"orbit-{az}", "azimuthDeg": az, "polarDeg": 90, "distance": 12})
    for az in (0, 90, 180, 270):
        for polar in (30, 150):
            samples.append({"id": f"pitch-{az}-{polar}", "azimuthDeg": az, "polarDeg": polar, "distance": 12})
    for az in (0, 180):
        for distance in (6, 20):
            samples.append({"id": f"distance-{az}-{distance}", "azimuthDeg": az, "polarDeg": 90, "distance": distance})
    contract = {
        "mode": "interactive-orbit",
        "request": {"source": "brief.md#viewing", "mode": "interactive-orbit", "bounds": copy.deepcopy(bounds)},
        "bounds": bounds,
        "requiredSamples": samples,
    }
    image_hash = hashlib.sha256(b"evidence placeholder").hexdigest()
    views = [
        {"sampleId": s["id"], "azimuthDeg": s["azimuthDeg"], "polarDeg": s["polarDeg"], "distance": s["distance"],
         "evidence": f"views/{s['id']}.png", "sha256": image_hash, "readability": "subject and environment read", "occlusion": "intentional only", "boundary": "inside rendered scene"}
        for s in samples
    ]
    return contract, views


class CameraContractTests(unittest.TestCase):
    def run_gate(self, mutate=None) -> str:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            (base / "views").mkdir()
            contract, views = camera_fixture()
            record = {key: {"status": "NOT_RUN", "reason": "outside this camera contract test"}
                      for key in ("dataIntegrity", "surfaceQuality", "routeFit", "supportContact", "composition", "proxyStage")}
            record["viewEnvelope"] = {"status": "PASS", "buildId": "proxy-v1", "scope": "interactive orbit within requested limits", "contract": "camera-envelope.json", "method": "coverage matrix capture and visual review", "evidence": [views[0]["evidence"]], "views": views}
            if mutate:
                mutate(contract, record)
            (base / "camera-envelope.json").write_text(json.dumps(contract), encoding="utf-8")
            for view in record["viewEnvelope"]["views"]:
                p = base / view["evidence"]
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b"evidence placeholder")
            path = base / "spatial-gate.json"
            path.write_text(json.dumps(record), encoding="utf-8")
            result = subprocess.run(["python3", str(SCRIPT), str(path)], text=True, capture_output=True, check=False)
            return result.stdout + result.stderr

    def test_captures_match_all_20_required_samples(self):
        output = self.run_gate()
        self.assertNotIn("viewEnvelope:", output)

    def test_missing_pitch_endpoint_sample_blocks(self):
        def mutate(contract, record):
            record["viewEnvelope"]["views"] = [v for v in record["viewEnvelope"]["views"] if v["sampleId"] != "pitch-0-30"]
        self.assertIn("required camera sample missing", self.run_gate(mutate))

    def test_contract_cannot_omit_required_pitch_and_distance_matrix(self):
        def mutate(contract, record):
            contract["requiredSamples"] = contract["requiredSamples"][:8]
        output = self.run_gate(mutate)
        self.assertIn("polar endpoint at four azimuths", output)
        self.assertIn("distance endpoint at two azimuths", output)

    def test_implementation_cannot_narrow_requested_bounds(self):
        def mutate(contract, record):
            contract["bounds"]["polarDeg"] = [45, 135]
        self.assertIn("narrows the requested camera scope", self.run_gate(mutate))

    def test_contract_must_trace_back_to_user_request(self):
        def mutate(contract, record):
            contract["request"]["source"] = ""
        self.assertIn("trace its requested mode", self.run_gate(mutate))

    def test_view_evidence_hash_must_match_the_captured_image(self):
        def mutate(contract, record):
            record["viewEnvelope"]["views"][0]["sha256"] = "0" * 64
        self.assertIn("evidence sha256 mismatch", self.run_gate(mutate))

    def test_view_envelope_requires_a_frozen_proxy_build_id(self):
        def mutate(contract, record):
            record["viewEnvelope"].pop("buildId")
        self.assertIn("PASS requires a buildId", self.run_gate(mutate))


if __name__ == "__main__":
    unittest.main()
