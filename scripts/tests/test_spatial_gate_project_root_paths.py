#!/usr/bin/env python3
"""Regression tests for project-root-relative evidence in qa/spatial-gate.json."""
from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "validate_spatial_gate.py"


class ProjectRootEvidencePathTests(unittest.TestCase):
    def make_project(self, temp: str) -> tuple[Path, dict]:
        root = Path(temp)
        qa = root / "qa"
        design = root / "design"
        (qa / "views").mkdir(parents=True)
        design.mkdir()

        bounds = {"azimuthDeg": [0, 360], "polarDeg": [20, 85], "distance": [10, 80]}
        samples = []
        for az in range(0, 360, 45):
            samples.append({"id": f"orbit-{az}", "azimuthDeg": az, "polarDeg": 60, "distance": 40})
        for az in (0, 90, 180, 270):
            for label, polar in (("min", 20), ("max", 85)):
                samples.append({"id": f"pitch-{az}-{label}", "azimuthDeg": az, "polarDeg": polar, "distance": 40})
        for az in (0, 180):
            for label, distance in (("near", 10), ("far", 80)):
                samples.append({"id": f"distance-{az}-{label}", "azimuthDeg": az, "polarDeg": 60, "distance": distance})

        contract = {
            "mode": "interactive-orbit",
            "request": {"source": "brief.md#viewing", "mode": "interactive-orbit", "bounds": bounds},
            "bounds": bounds,
            "requiredSamples": samples,
        }
        (design / "camera-envelope.json").write_text(json.dumps(contract), encoding="utf-8")

        views = []
        for sample in samples:
            evidence = f"qa/views/{sample['id']}.png"
            image = root / evidence
            image.write_bytes(f"evidence:{sample['id']}".encode())
            views.append({
                "sampleId": sample["id"],
                "azimuthDeg": sample["azimuthDeg"],
                "polarDeg": sample["polarDeg"],
                "distance": sample["distance"],
                "evidence": evidence,
                "sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
                "readability": "scene is visible",
                "occlusion": "no critical occlusion",
                "boundary": "within contract bounds",
            })

        record = {
            key: {"status": "NOT_RUN", "reason": "not covered by this path test"}
            for key in ("dataIntegrity", "surfaceQuality", "routeFit", "supportContact", "composition", "proxyStage")
        }
        record["viewEnvelope"] = {
            "status": "PASS",
            "buildId": "proxy-path-v1",
            "scope": "full orbit and pitch/distance limits",
            "contract": "design/camera-envelope.json",
            "method": "capture the required view matrix and inspect the images",
            "evidence": [views[0]["evidence"]],
            "views": views,
        }
        gate = qa / "spatial-gate.json"
        gate.write_text(json.dumps(record), encoding="utf-8")
        return gate, record

    def test_project_root_paths_resolve_from_qa_gate(self):
        with tempfile.TemporaryDirectory() as temp:
            gate, _ = self.make_project(temp)
            result = subprocess.run(["python3", str(SCRIPT), str(gate)], text=True, capture_output=True, check=False)
            output = result.stdout + result.stderr
            self.assertEqual(result.returncode, 1)  # Other checks are deliberately NOT_RUN.
            self.assertIn("NOT_RUN:", output)
            self.assertNotIn("viewEnvelope:", output)

    def test_fail_evidence_uses_the_same_project_root(self):
        with tempfile.TemporaryDirectory() as temp:
            gate, record = self.make_project(temp)
            record["proxyStage"] = {
                "status": "FAIL",
                "method": "compare the frozen proxy against the spatial contract",
                "evidence": ["qa/views/orbit-0.png"],
            }
            gate.write_text(json.dumps(record), encoding="utf-8")
            result = subprocess.run(["python3", str(SCRIPT), str(gate)], text=True, capture_output=True, check=False)
            output = result.stdout + result.stderr
            self.assertIn("FAIL: proxyStage", output)
            self.assertNotIn("proxyStage: evidence file missing", output)


if __name__ == "__main__":
    unittest.main()
