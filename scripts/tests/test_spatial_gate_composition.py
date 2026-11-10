#!/usr/bin/env python3
"""Regression tests for evidence-backed, multi-dimension composition gates."""
from __future__ import annotations

import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "validate_spatial_gate.py"
DIMENSIONS = (
    "focus-and-hierarchy", "environment-and-depth", "negative-space-and-crop",
    "critical-relations", "scale-and-occupancy", "task-specific",
)


def gate_fixture() -> dict:
    record = {key: {"status": "NOT_RUN", "reason": "outside this composition test"}
              for key in ("dataIntegrity", "surfaceQuality", "routeFit", "supportContact", "viewEnvelope", "proxyStage")}
    record["composition"] = {
        "status": "PASS", "buildId": "proxy-v1", "viewMode": "neutral-proxy", "method": "unlabeled target-view review", "evidence": ["overview.png"],
        "unlabeledViews": ["overview.png"],
        "criteria": [
            {"dimension": d, "criterion": f"scene-specific review of {d}", "status": "PASS", "evidence": [f"criteria/{d}.png"]}
            for d in DIMENSIONS
        ],
    }
    return record


class CompositionGateTests(unittest.TestCase):
    def run_gate(self, mutate=None) -> str:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            record = gate_fixture()
            if mutate:
                mutate(record)
            for rel in ("overview.png", *(f"criteria/{d}.png" for d in DIMENSIONS)):
                path = base / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"evidence placeholder")
            gate = base / "spatial-gate.json"
            gate.write_text(json.dumps(record), encoding="utf-8")
            result = subprocess.run(["python3", str(SCRIPT), str(gate)], text=True, capture_output=True, check=False)
            return result.stdout + result.stderr

    def test_complete_dimension_matrix_passes_composition(self):
        output = self.run_gate()
        self.assertNotIn("composition:", output)

    def test_missing_dimension_blocks_pass(self):
        def mutate(record):
            record["composition"]["criteria"].pop(0)
        self.assertIn("missing required dimensions", self.run_gate(mutate))

    def test_pass_without_dimension_evidence_blocks(self):
        def mutate(record):
            record["composition"]["criteria"][1]["evidence"] = ["criteria/missing.png"]
        self.assertIn("dimension-specific evidence files", self.run_gate(mutate))

    def test_not_applicable_requires_reason(self):
        def mutate(record):
            item = record["composition"]["criteria"][3]
            item["status"] = "NOT_APPLICABLE"
            item.pop("evidence", None)
        self.assertIn("NOT_APPLICABLE criterion", self.run_gate(mutate))


if __name__ == "__main__":
    unittest.main()
