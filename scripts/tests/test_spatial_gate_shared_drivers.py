#!/usr/bin/env python3
"""Regression tests proving each declared shared driver reaches its consumers."""
from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "validate_spatial_gate.py"


def data_fixture(base: Path) -> dict:
    register = {
        "sharedDrivers": [{
            "id": "wetness-field",
            "consumers": [
                {"id": "bank-profile", "system": "geometry", "output": "shore profile"},
                {"id": "plant-density", "system": "distribution", "output": "instance density"},
            ],
        }],
    }
    register_path = base / "spatial-register.json"
    register_path.write_text(json.dumps(register), encoding="utf-8")
    register_hash = hashlib.sha256(register_path.read_bytes()).hexdigest()
    evidence = []
    consumers = []
    for consumer_id in ("bank-profile", "plant-density"):
        before = f"before-{consumer_id}.png"
        after = f"after-{consumer_id}.png"
        before_bytes = f"baseline output for {consumer_id}".encode()
        after_bytes = f"perturbed output for {consumer_id}".encode()
        (base / before).write_bytes(before_bytes)
        (base / after).write_bytes(after_bytes)
        evidence.extend([before, after])
        consumers.append({
            "id": consumer_id,
            "baselineOutputSha256": hashlib.sha256(before_bytes).hexdigest(),
            "perturbedOutputSha256": hashlib.sha256(after_bytes).hexdigest(),
            "evidence": [before, after],
            "observedEffect": f"{consumer_id} visibly responds to wetness-field",
        })
    check = {
        "sourceRegisterSha256": register_hash,
        "renderContract": {"seed": 7, "camera": "proxy-main", "resolution": [1280, 720], "otherInputsLocked": True},
        "driverChecks": [{
            "driverId": "wetness-field",
            "inputChange": {"before": 0.1, "after": 0.8, "reason": "meaningful in-scene perturbation"},
            "consumers": consumers,
        }],
    }
    check_path = base / "consumer-check.json"
    check_path.write_text(json.dumps(check), encoding="utf-8")
    record = {
        key: {"status": "NOT_RUN", "reason": "outside shared-driver test"}
        for key in ("surfaceQuality", "routeFit", "supportContact", "composition", "viewEnvelope", "proxyStage")
    }
    record["dataIntegrity"] = {
        "status": "PASS",
        "method": "perturb shared driver and inspect every declared consumer",
        "evidence": evidence,
        "sourceRegister": "spatial-register.json",
        "consumerCheck": "consumer-check.json",
    }
    return record


class SharedDriverConsumerTests(unittest.TestCase):
    def run_gate(self, mutate=None) -> str:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            record = data_fixture(base)
            check_path = base / "consumer-check.json"
            check = json.loads(check_path.read_text(encoding="utf-8"))
            if mutate:
                mutate(record, check, base)
            check_path.write_text(json.dumps(check), encoding="utf-8")
            gate = base / "spatial-gate.json"
            gate.write_text(json.dumps(record), encoding="utf-8")
            result = subprocess.run(["python3", str(SCRIPT), str(gate)], text=True, capture_output=True, check=False)
            return result.stdout + result.stderr

    def test_all_declared_consumers_have_changed_outputs_and_paired_evidence(self):
        output = self.run_gate()
        self.assertNotIn("dataIntegrity:", output)

    def test_missing_consumer_is_not_hidden_by_other_consumer_pass(self):
        def mutate(record, check, base):
            check["driverChecks"][0]["consumers"].pop()
        self.assertIn("consumers do not match the register", self.run_gate(mutate))

    def test_unchanged_consumer_output_blocks_data_integrity(self):
        def mutate(record, check, base):
            consumer = check["driverChecks"][0]["consumers"][1]
            (base / consumer["evidence"][1]).write_bytes((base / consumer["evidence"][0]).read_bytes())
            consumer["perturbedOutputSha256"] = consumer["baselineOutputSha256"]
        self.assertIn("output hashes must differ", self.run_gate(mutate))

    def test_unchanged_driver_input_blocks_data_integrity(self):
        def mutate(record, check, base):
            check["driverChecks"][0]["inputChange"]["after"] = 0.1
        self.assertIn("inputChange before and after must differ", self.run_gate(mutate))

    def test_unregistered_or_duplicate_driver_tests_are_rejected(self):
        def mutate(record, check, base):
            check["driverChecks"].append(copy.deepcopy(check["driverChecks"][0]))
        self.assertIn("duplicate driverCheck", self.run_gate(mutate))

    def test_perturbation_must_freeze_camera_seed_resolution_and_other_inputs(self):
        def mutate(record, check, base):
            check.pop("renderContract", None)
        self.assertIn("renderContract must freeze seed, camera, resolution, and other inputs", self.run_gate(mutate))


if __name__ == "__main__":
    unittest.main()
