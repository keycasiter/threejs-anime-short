#!/usr/bin/env python3
"""Regression tests for proving the proxy stage precedes formal asset work."""
from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "validate_spatial_gate.py"


class ProxyStageGateTests(unittest.TestCase):
    def run_gate(self, mutate=None) -> str:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source = base / "proxy-source.html"
            source.write_text("<canvas>spatial proxy only</canvas>", encoding="utf-8")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            inventory = {
                "stage": "spatial-proxy",
                "buildId": "proxy-v1",
                "renderMode": "neutral",
                "sourceSha256": digest,
                "formalAssetsStarted": False,
                "formalAssetCount": 0,
                "detailedMaterialCount": 0,
                "detailGeneratorCount": 0,
                "components": [{"id": "terrain-envelope", "role": "proxy"}, {"id": "route-network", "role": "proxy"}],
            }
            (base / "proxy-inventory.json").write_text(json.dumps(inventory), encoding="utf-8")
            review = {
                "result": "PASS",
                "buildId": "proxy-v1",
                "reviewedSourceSha256": digest,
                "formalAssetsStarted": False,
                "reviewedSampleIds": ["target-main"],
                "reviewer": "independent visual review",
            }
            (base / "proxy-review.json").write_text(json.dumps(review), encoding="utf-8")
            (base / "proxy-gray.png").write_bytes(b"neutral proxy view")
            record = {
                key: {"status": "NOT_RUN", "reason": "outside this proxy integrity test"}
                for key in ("dataIntegrity", "surfaceQuality", "routeFit", "supportContact", "composition", "viewEnvelope")
            }
            record["proxyStage"] = {
                "status": "PASS",
                "buildId": "proxy-v1",
                "method": "review the frozen neutral proxy build before formal asset work",
                "evidence": ["proxy-gray.png"],
                "sourceSnapshot": "proxy-source.html",
                "sourceSha256": digest,
                "inventory": "proxy-inventory.json",
                "reviewRecord": "proxy-review.json",
            }
            if mutate:
                mutate(record, inventory, review, source, digest)
                (base / "proxy-inventory.json").write_text(json.dumps(inventory), encoding="utf-8")
                (base / "proxy-review.json").write_text(json.dumps(review), encoding="utf-8")
            gate = base / "spatial-gate.json"
            gate.write_text(json.dumps(record), encoding="utf-8")
            result = subprocess.run(["python3", str(SCRIPT), str(gate)], text=True, capture_output=True, check=False)
            return result.stdout + result.stderr

    def test_frozen_neutral_proxy_without_formal_assets_is_accepted(self):
        output = self.run_gate()
        self.assertNotIn("proxyStage:", output)

    def test_formal_models_block_proxy_release(self):
        def mutate(record, inventory, review, source, digest):
            inventory["formalAssetCount"] = 1
        self.assertIn("formalAssetCount must be 0", self.run_gate(mutate))

    def test_detailed_materials_block_proxy_release(self):
        def mutate(record, inventory, review, source, digest):
            inventory["renderMode"] = "final-lookdev"
            inventory["detailedMaterialCount"] = 4
        output = self.run_gate(mutate)
        self.assertIn("renderMode must be neutral", output)
        self.assertIn("detailedMaterialCount must be 0", output)

    def test_source_snapshot_hash_must_match_inventory_and_review(self):
        def mutate(record, inventory, review, source, digest):
            source.write_text("proxy changed after review", encoding="utf-8")
        self.assertIn("sourceSnapshot SHA-256 mismatch", self.run_gate(mutate))

    def test_review_must_precede_formal_asset_work(self):
        def mutate(record, inventory, review, source, digest):
            review["formalAssetsStarted"] = True
        self.assertIn("review must record formalAssetsStarted=false", self.run_gate(mutate))

    def test_proxy_stage_cannot_be_waived_as_not_applicable(self):
        def mutate(record, inventory, review, source, digest):
            record["proxyStage"] = {"status": "NOT_APPLICABLE", "reason": "reuse"}
        self.assertIn("cannot be NOT_APPLICABLE", self.run_gate(mutate))

    def test_orbit_views_must_belong_to_the_frozen_proxy_build(self):
        def mutate(record, inventory, review, source, digest):
            record["viewEnvelope"] = {"status": "PASS", "buildId": "different-build", "views": [{"sampleId": "target-main"}]}
        self.assertIn("same proxy buildId", self.run_gate(mutate))

    def test_proxy_review_must_name_the_captured_orbit_samples(self):
        def mutate(record, inventory, review, source, digest):
            record["viewEnvelope"] = {"status": "PASS", "buildId": "proxy-v1", "views": [{"sampleId": "unreviewed-angle"}]}
        self.assertIn("reviewedSampleIds must match", self.run_gate(mutate))


if __name__ == "__main__":
    unittest.main()
