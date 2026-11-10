from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))
import validate_delivery  # noqa: E402


class DeliveryManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.artifact = self.root / "brief.md"
        self.artifact.write_text("frozen input\n", encoding="utf-8")
        self.digest = hashlib.sha256(self.artifact.read_bytes()).hexdigest()
        self.register = self.root / "scene-register.json"
        self.register.write_text(json.dumps({
            "evidence": {"e1": {"status": "Designed"}},
            "objects": [{
                "id": "ground", "status": "Designed", "geometryRole": "surface", "evidence": ["e1"],
                "fieldEvidence": {"anchor": {"status": "Designed", "sourceIds": ["e1"], "confidence": "high"}},
                "anchor": {"xyz": [0, 0, 0], "space": "world"},
                "bounds": {"center": "anchor", "size": [4, 1, 4]}, "baseY": -0.5, "topY": 0.5,
            }],
        }), encoding="utf-8")
        self.register_digest = hashlib.sha256(self.register.read_bytes()).hexdigest()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_manifest(self, payload: dict) -> Path:
        path = self.root / "delivery-manifest.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def minimal_analysis_manifest(self) -> dict:
        return {
            "schemaVersion": 1,
            "mode": "analysis-only",
            "buildId": "design-v1",
            "sceneRegisterPath": "scene-register.json",
            "stages": [
                {
                    "id": "direction",
                    "status": "PASS",
                    "buildId": "design-v1",
                    "evidence": [{"path": "brief.md", "sha256": self.digest}],
                    "inputs": [],
                },
                {
                    "id": "visualAnalysis",
                    "status": "PASS",
                    "buildId": "design-v1",
                    "evidence": [{"path": "scene-register.json", "sha256": self.register_digest}],
                    "inputs": [{"path": "brief.md", "sha256": self.digest}],
                },
            ],
        }

    def test_analysis_only_manifest_passes_with_hashed_stage_handoffs(self) -> None:
        manifest = self.write_manifest(self.minimal_analysis_manifest())
        self.assertEqual([], validate_delivery.validate_manifest(manifest))

    def test_analysis_only_runs_the_scene_register_validator(self) -> None:
        data = self.minimal_analysis_manifest()
        self.register.write_text("{}", encoding="utf-8")
        data["stages"][1]["evidence"][0]["sha256"] = hashlib.sha256(self.register.read_bytes()).hexdigest()
        issues = validate_delivery.validate_data(data, self.root)
        self.assertTrue(any("validate_scene_register.py blocked" in issue for issue in issues))

    def test_runtime_preflight_failure_blocks_implementation_release(self) -> None:
        capture = self.root / "preflight.png"
        capture.write_bytes(b"placeholder without renderer")
        report = self.root / "preflight.json"
        report.write_text(json.dumps({
            "status": "NOT_RUN", "buildId": "preflight-v1", "threeVersion": "0.180.0",
            "browser": "Chromium", "renderer": "unavailable", "dependencyStrategy": "local bundle", "consoleErrors": [], "failedRequests": [],
            "capture": {"path": "preflight.png", "sha256": hashlib.sha256(capture.read_bytes()).hexdigest()},
        }), encoding="utf-8")
        issues: list[str] = []
        validate_delivery._validate_runtime_preflight(
            self.root,
            {"buildId": "preflight-v1", "preflightReport": "preflight.json", "evidence": [
                {"path": "preflight.json", "sha256": hashlib.sha256(report.read_bytes()).hexdigest()},
                {"path": "preflight.png", "sha256": hashlib.sha256(capture.read_bytes()).hexdigest()},
            ]},
            issues,
        )
        self.assertTrue(any("report must PASS" in issue for issue in issues))
        self.assertTrue(any("initialized Three.js rendering backend" in issue for issue in issues))

    def test_blocked_preflight_does_not_require_an_unrun_spatial_gate_file(self) -> None:
        data = self.minimal_analysis_manifest()
        data["mode"] = "full-production"
        data["buildId"] = "scene-v1"
        report = self.root / "preflight.json"
        report.write_text(json.dumps({
            "status": "BLOCKED", "buildId": "preflight-v1", "threeVersion": "0.180.0",
            "browser": "Chromium", "renderer": None, "dependencyStrategy": "local bundle",
            "consoleErrors": [], "failedRequests": [], "capture": None,
            "blocker": "local server cannot bind in this environment",
        }), encoding="utf-8")
        blocker = self.root / "preflight-blocker.log"
        blocker.write_text("PermissionError binding localhost", encoding="utf-8")
        report_hash = hashlib.sha256(report.read_bytes()).hexdigest()
        blocker_hash = hashlib.sha256(blocker.read_bytes()).hexdigest()
        register_ref = {"path": "scene-register.json", "sha256": self.register_digest}
        data["stages"].extend([
            {
                "id": "runtimePreflight", "status": "BLOCKED", "buildId": "preflight-v1",
                "inputs": [register_ref], "preflightReport": "preflight.json",
                "evidence": [{"path": "preflight.json", "sha256": report_hash}, {"path": "preflight-blocker.log", "sha256": blocker_hash}],
            },
            {"id": "spatialProxy", "status": "NOT_RUN", "buildId": "proxy-v1", "inputs": [], "evidence": []},
        ])
        issues = validate_delivery.validate_data(data, self.root, through="spatialProxy")
        joined = "\n".join(issues)
        self.assertIn("stage runtimePreflight must be PASS", joined)
        self.assertNotIn("spatialGatePath must reference", joined)

    def test_mechanism_test_scope_does_not_require_the_full_production_chain(self) -> None:
        data = self.minimal_analysis_manifest()
        data["mode"] = "mechanism-test"
        data["stages"] = [{
            "id": "mechanismTest", "status": "PASS", "buildId": "design-v1",
            "evidence": [{"path": "brief.md", "sha256": self.digest}], "inputs": [],
        }]
        self.assertEqual([], validate_delivery.validate_data(data, self.root))

    def test_missing_required_stage_blocks(self) -> None:
        data = self.minimal_analysis_manifest()
        data["stages"].pop()
        issues = validate_delivery.validate_data(data, self.root)
        self.assertTrue(any("visualAnalysis" in issue and "required" in issue for issue in issues))

    def test_stage_must_declare_its_own_build_id(self) -> None:
        data = self.minimal_analysis_manifest()
        data["stages"][1]["buildId"] = ""
        issues = validate_delivery.validate_data(data, self.root)
        self.assertTrue(any("requires its own buildId" in issue for issue in issues))

    def test_artifact_hash_detects_stale_output(self) -> None:
        data = self.minimal_analysis_manifest()
        data["stages"][1]["evidence"][0]["sha256"] = "0" * 64
        issues = validate_delivery.validate_data(data, self.root)
        self.assertTrue(any("SHA-256 mismatch" in issue for issue in issues))

    def test_handoff_cannot_reference_artifact_not_produced_upstream(self) -> None:
        data = self.minimal_analysis_manifest()
        unrelated = self.root / "unrelated.md"
        unrelated.write_text("not an upstream output\n", encoding="utf-8")
        digest = hashlib.sha256(unrelated.read_bytes()).hexdigest()
        data["stages"][1]["inputs"] = [{"path": "unrelated.md", "sha256": digest}]
        issues = validate_delivery.validate_data(data, self.root)
        self.assertTrue(any("not produced by an earlier stage" in issue for issue in issues))

    def test_not_run_stage_blocks_even_with_evidence(self) -> None:
        data = self.minimal_analysis_manifest()
        data["stages"][1]["status"] = "NOT_RUN"
        issues = validate_delivery.validate_data(data, self.root)
        self.assertTrue(any("must be PASS" in issue for issue in issues))

    def test_full_production_requires_runtime_visual_review_and_delivery(self) -> None:
        data = self.minimal_analysis_manifest()
        data["mode"] = "full-production"
        issues = validate_delivery.validate_data(data, self.root)
        joined = "\n".join(issues)
        for stage_id in ("spatialProxy", "runtime", "visualReview", "delivery"):
            self.assertIn(stage_id, joined)

    def test_stage_order_must_follow_declared_pipeline(self) -> None:
        data = self.minimal_analysis_manifest()
        data["stages"].reverse()
        issues = validate_delivery.validate_data(data, self.root)
        self.assertTrue(any("order" in issue for issue in issues))

    def test_full_production_can_be_released_at_an_intermediate_stage(self) -> None:
        data = self.minimal_analysis_manifest()
        data["mode"] = "full-production"
        data["stages"] = data["stages"][:1]
        issues = validate_delivery.validate_data(data, self.root, through="direction")
        self.assertEqual([], issues)

    def test_intermediate_release_cannot_claim_a_stage_outside_selected_mode(self) -> None:
        data = self.minimal_analysis_manifest()
        issues = validate_delivery.validate_data(data, self.root, through="spatialProxy")
        self.assertTrue(any("not part of mode" in issue for issue in issues))

    def test_spatial_handoff_runs_register_and_spatial_gate_validators(self) -> None:
        register = self.root / "scene-register.json"
        register.write_text("{}", encoding="utf-8")
        gate = self.root / "spatial-gate.json"
        gate.write_text("{}", encoding="utf-8")
        brief = self.root / "brief.md"
        brief.write_text("brief", encoding="utf-8")
        proxy = self.root / "proxy.html"
        proxy.write_text("proxy", encoding="utf-8")
        preflight_capture = self.root / "qa" / "preflight.png"
        preflight_capture.parent.mkdir(parents=True, exist_ok=True)
        preflight_capture.write_bytes(b"webgl capture")
        preflight_report = self.root / "qa" / "preflight.json"
        preflight_report.write_text(json.dumps({
            "status": "PASS", "buildId": "preflight-v1", "threeVersion": "0.180.0",
            "browser": "Chromium", "renderer": "WebGL2", "dependencyStrategy": "local bundle", "consoleErrors": [], "failedRequests": [],
            "capture": {"path": "qa/preflight.png", "sha256": hashlib.sha256(preflight_capture.read_bytes()).hexdigest()},
        }), encoding="utf-8")
        digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        data = {
            "schemaVersion": 1,
            "mode": "spatial-handoff",
            "buildId": "proxy-v1",
            "sceneRegisterPath": "scene-register.json",
            "spatialGatePath": "spatial-gate.json",
            "stages": [
                {"id": "direction", "status": "PASS", "buildId": "proxy-v1", "inputs": [], "evidence": [{"path": "brief.md", "sha256": digest(brief)}]},
                {"id": "visualAnalysis", "status": "PASS", "buildId": "proxy-v1", "inputs": [{"path": "brief.md", "sha256": digest(brief)}], "evidence": [{"path": "scene-register.json", "sha256": digest(register)}]},
                {"id": "runtimePreflight", "status": "PASS", "buildId": "preflight-v1", "inputs": [{"path": "scene-register.json", "sha256": digest(register)}], "evidence": [{"path": "qa/preflight.json", "sha256": digest(preflight_report)}, {"path": "qa/preflight.png", "sha256": digest(preflight_capture)}], "preflightReport": "qa/preflight.json"},
                {"id": "spatialProxy", "status": "PASS", "buildId": "proxy-v1", "inputs": [{"path": "scene-register.json", "sha256": digest(register)}], "evidence": [{"path": "spatial-gate.json", "sha256": digest(gate)}, {"path": "proxy.html", "sha256": digest(proxy)}]},
            ],
        }
        issues = validate_delivery.validate_data(data, self.root)
        joined = "\n".join(issues)
        self.assertIn("validate_scene_register.py blocked", joined)
        self.assertIn("validate_spatial_gate.py blocked", joined)

    def test_complete_spatial_handoff_passes_integrated_gates(self) -> None:
        def put_json(relative: str, value: dict) -> Path:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(value), encoding="utf-8")
            return path

        def ref(path: Path) -> dict[str, str]:
            return {"path": path.relative_to(self.root).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}

        brief = self.root / "brief.md"
        brief.write_text("small flat spatial handoff", encoding="utf-8")
        evidence_image = self.root / "qa" / "proxy.png"
        evidence_image.parent.mkdir(parents=True)
        evidence_image.write_bytes(b"proxy pixels")
        simple_register = put_json("design/scene-register.json", {
            "evidence": {"e1": {"status": "Designed"}},
            "objects": [{
                "id": "ground", "status": "Designed", "geometryRole": "surface", "evidence": ["e1"],
                "fieldEvidence": {"anchor": {"status": "Designed", "sourceIds": ["e1"], "confidence": "high"}},
                "anchor": {"xyz": [0, 0, 0], "space": "world"},
                "bounds": {"center": "anchor", "size": [4, 1, 4]}, "baseY": -0.5, "topY": 0.5,
            }],
        })
        source = self.root / "proxy-source.html"
        source.write_text("neutral proxy source", encoding="utf-8")
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        preflight_capture = self.root / "qa" / "preflight.png"
        preflight_capture.parent.mkdir(parents=True, exist_ok=True)
        preflight_capture.write_bytes(b"webgl capture")
        preflight_report = put_json("qa/preflight.json", {
            "status": "PASS", "buildId": "preflight-v1", "threeVersion": "0.180.0",
            "browser": "Chromium", "renderer": "WebGL2", "dependencyStrategy": "local bundle", "consoleErrors": [], "failedRequests": [],
            "capture": {"path": "qa/preflight.png", "sha256": hashlib.sha256(preflight_capture.read_bytes()).hexdigest()},
        })
        put_json("proxy-inventory.json", {
            "stage": "spatial-proxy", "buildId": "proxy-v1", "renderMode": "neutral",
            "sourceSha256": source_hash, "formalAssetsStarted": False, "formalAssetCount": 0,
            "detailedMaterialCount": 0, "detailGeneratorCount": 0,
            "components": [{"id": "ground", "role": "proxy"}],
        })
        put_json("proxy-review.json", {
            "result": "PASS", "buildId": "proxy-v1", "reviewedSourceSha256": source_hash,
            "formalAssetsStarted": False, "reviewedSampleIds": ["main"], "reviewer": "visual reviewer",
        })
        consumer_check = put_json("qa/consumer-check.json", {"status": "no shared drivers declared"})
        gate_data = {
            key: {"status": "NOT_APPLICABLE", "reason": "not present in this compact proxy test"}
            for key in ("surfaceQuality", "routeFit", "supportContact", "viewEnvelope")
        }
        gate_data["dataIntegrity"] = {
            "status": "PASS", "sourceRegister": "design/scene-register.json", "consumerCheck": "qa/consumer-check.json",
            "method": "check register and declared consumers", "evidence": ["qa/consumer-check.json"],
        }
        dimensions = ("focus-and-hierarchy", "environment-and-depth", "negative-space-and-crop", "critical-relations", "scale-and-occupancy", "task-specific")
        gate_data["composition"] = {
            "status": "PASS", "buildId": "proxy-v1", "viewMode": "neutral-proxy",
            "method": "review target view", "evidence": ["qa/proxy.png"], "unlabeledViews": ["qa/proxy.png"],
            "criteria": [{"dimension": dimension, "criterion": f"review {dimension}", "status": "PASS", "evidence": ["qa/proxy.png"]} for dimension in dimensions],
        }
        gate_data["proxyStage"] = {
            "status": "PASS", "buildId": "proxy-v1", "method": "freeze and review proxy before assets",
            "evidence": ["qa/proxy.png"], "sourceSnapshot": "proxy-source.html", "sourceSha256": source_hash,
            "inventory": "proxy-inventory.json", "reviewRecord": "proxy-review.json",
        }
        gate = put_json("spatial-gate.json", gate_data)
        proxy = self.root / "proxy.html"
        proxy.write_text("neutral proxy output", encoding="utf-8")
        data = {
            "schemaVersion": 1, "mode": "spatial-handoff", "buildId": "proxy-v1",
            "sceneRegisterPath": "design/scene-register.json", "spatialGatePath": "spatial-gate.json",
            "stages": [
                {"id": "direction", "status": "PASS", "buildId": "proxy-v1", "inputs": [], "evidence": [ref(brief)]},
                {"id": "visualAnalysis", "status": "PASS", "buildId": "analysis-v1", "inputs": [ref(brief)], "evidence": [ref(simple_register)]},
                {"id": "runtimePreflight", "status": "PASS", "buildId": "preflight-v1", "inputs": [ref(simple_register)], "evidence": [ref(preflight_report), ref(preflight_capture)], "preflightReport": "qa/preflight.json"},
                {"id": "spatialProxy", "status": "PASS", "buildId": "proxy-v1", "inputs": [ref(simple_register)], "evidence": [ref(gate), ref(proxy)]},
            ],
        }
        self.assertEqual([], validate_delivery.validate_data(data, self.root))

    def runtime_fixture(self, sample_count: int = 20) -> tuple[dict, dict]:
        samples = []
        for azimuth in range(0, 360, 45):
            samples.append({"id": f"az-{azimuth}", "azimuthDeg": azimuth, "polarDeg": 90, "distance": 5})
        for azimuth in (0, 90, 180, 270):
            for polar in (18, 162):
                samples.append({"id": f"pitch-{azimuth}-{polar}", "azimuthDeg": azimuth, "polarDeg": polar, "distance": 5})
        for azimuth in (0, 180):
            for distance in (1, 10):
                samples.append({"id": f"distance-{azimuth}-{distance}", "azimuthDeg": azimuth, "polarDeg": 90, "distance": distance})
        samples = samples[:sample_count]
        contract = {"mode": "interactive-orbit", "bounds": {"azimuthDeg": [0, 360], "polarDeg": [18, 162], "distance": [1, 10]}, "requiredSamples": samples}
        captures = []
        for sample in samples:
            image = self.root / f"{sample['id']}.png"
            image.write_bytes(f"pixels:{sample['id']}".encode())
            captures.append({**sample, "path": image.name, "sha256": hashlib.sha256(image.read_bytes()).hexdigest()})
        contract_path = self.root / "camera-contract.json"
        contract_path.write_text(json.dumps(contract), encoding="utf-8")
        runtime = {
            "status": "PASS", "buildId": "final-v1", "threeVersion": "0.180.0", "browser": "Chromium",
            "consoleErrors": [], "failedRequests": [], "captures": captures,
        }
        runtime_path = self.root / "runtime-report.json"
        runtime_path.write_text(json.dumps(runtime), encoding="utf-8")
        return contract, runtime

    def test_runtime_captures_match_all_final_orbit_contract_samples(self) -> None:
        self.runtime_fixture()
        issues: list[str] = []
        captures = validate_delivery._validate_runtime_report(
            self.root, "runtime-report.json", "final-v1", "camera-contract.json", issues,
        )
        self.assertEqual([], issues)
        self.assertEqual(20, len(captures))

    def test_runtime_missing_orbit_sample_blocks_release(self) -> None:
        _, runtime = self.runtime_fixture()
        runtime["captures"].pop()
        (self.root / "runtime-report.json").write_text(json.dumps(runtime), encoding="utf-8")
        issues: list[str] = []
        validate_delivery._validate_runtime_report(self.root, "runtime-report.json", "final-v1", "camera-contract.json", issues)
        self.assertTrue(any("cover every final camera contract" in issue for issue in issues))

    def test_full_360_runtime_contract_needs_envelope_samples(self) -> None:
        self.runtime_fixture(sample_count=8)
        issues: list[str] = []
        validate_delivery._validate_runtime_report(self.root, "runtime-report.json", "final-v1", "camera-contract.json", issues)
        self.assertTrue(any("at least 20 envelope samples" in issue for issue in issues))

    def test_full_orbit_samples_must_cover_pitch_and_distance_endpoints(self) -> None:
        _, runtime = self.runtime_fixture()
        contract_path = self.root / "camera-contract.json"
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
        sample = next(item for item in contract["requiredSamples"] if item["id"] == "pitch-0-18")
        sample["azimuthDeg"] = 45
        capture = next(item for item in runtime["captures"] if item["id"] == "pitch-0-18")
        capture["azimuthDeg"] = 45
        contract_path.write_text(json.dumps(contract), encoding="utf-8")
        (self.root / "runtime-report.json").write_text(json.dumps(runtime), encoding="utf-8")
        issues: list[str] = []
        validate_delivery._validate_runtime_report(self.root, "runtime-report.json", "final-v1", "camera-contract.json", issues)
        self.assertTrue(any("missing pitch endpoint" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()
