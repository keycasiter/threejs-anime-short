from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import struct
import zlib
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))
import validate_delivery  # noqa: E402


def png_bytes(width: int, height: int) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)
    raw = b"".join(b"\x00" + b"\x80\x80\x80" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


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
            "sections": [{"id": "section-main", "plane": "vertical", "station": "x=0", "points": [[0, 0, -2], [0, 0.5, 0], [0, 0, 2]], "objectIds": ["ground"]}],
        }), encoding="utf-8")
        self.register_digest = hashlib.sha256(self.register.read_bytes()).hexdigest()
        references = []
        for ref_id, family, direction, targets in (
            ("global-east", "global", "east-facing", []),
            ("global-west", "global", "west-facing", []),
            ("site-plan", "plan", "top-down", []),
            ("ground-detail", "asset-detail", "north-west close view", [{"type": "object", "id": "ground"}]),
        ):
            image_path = self.root / f"{ref_id}.svg"
            image_path.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#888"/></svg>', encoding="utf-8")
            references.append({
                "id": ref_id, "sourceType": "generated-diagram", "source": f"Designed reference {ref_id}",
                "path": image_path.name, "sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
                "viewFamily": family, "viewDirection": direction, "targetIds": targets,
                "purpose": "Test visual coverage", "limits": ["Test image, not factual evidence"], "confidence": "medium",
            })
        self.reference_index = self.root / "visual-reference-index.json"
        self.reference_index.write_text(json.dumps({"schemaVersion": 1, "references": references}), encoding="utf-8")
        self.reference_index_digest = hashlib.sha256(self.reference_index.read_bytes()).hexdigest()
        self.visual_build_map = self.root / "visual-build-map.json"
        self.visual_build_map.write_text(json.dumps({
            "schemaVersion": 1, "buildId": "design-v1", "entries": [{
                "id": "ground-form", "target": {"type": "object", "id": "ground"}, "priority": "focal",
                "referenceIds": ["ground-detail"],
                "features": [
                    {"id": "ground-profile", "referenceId": "ground-detail", "category": "silhouette", "observation": "The ground rises into a broad central ridge before falling toward the outer edge.", "designConstraint": "Keep the central ridge wider than the edge and readable in both side and oblique captures.", "confidence": "medium"},
                    {"id": "ground-layer", "referenceId": "ground-detail", "category": "volume", "observation": "The outer rim shows two visible strata with a shallow ledge between them.", "designConstraint": "Model two continuous strata and a ledge; do not substitute isolated rocks for the rim profile.", "confidence": "medium"},
                    {"id": "ground-material", "referenceId": "ground-detail", "category": "material", "observation": "The broad top is matte while exposed sides are darker and visibly rougher.", "designConstraint": "Use separate top and exposed-side material response so the profile remains readable under the key light.", "confidence": "low"},
                ],
                "implementationPlan": {
                    "component": "buildGroundSurface",
                    "geometryStrategy": "Create a sampled BufferGeometry heightfield and a separately profiled edge wall.",
                    "constructionSteps": ["Sample the registered surface profile on a regular grid and preserve its central ridge.", "Generate the rim strata from the edge profile and verify continuity in side captures."],
                    "materialTreatment": "Assign matte sediment to the upper surface and rough dark basalt to exposed strata."
                },
                "intentionalDeviations": []
            }]
        }), encoding="utf-8")
        self.visual_build_map_digest = hashlib.sha256(self.visual_build_map.read_bytes()).hexdigest()
        drawings = []
        for drawing_id, kind, filebase in (("site-plan", "plan", "drawing-site-plan"), ("section-main", "section", "drawing-section-main")):
            source = self.root / f"{filebase}.svg"
            source.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path d="M16 16h224v224H16z" fill="none" stroke="black"/></svg>', encoding="utf-8")
            preview = self.root / f"{filebase}.png"
            preview.write_bytes(png_bytes(640, 360))
            drawings.append({
                "id": drawing_id, "kind": kind, "status": "PASS",
                "source": {"path": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()},
                "preview": {"path": preview.name, "sha256": hashlib.sha256(preview.read_bytes()).hexdigest()},
                "observation": f"The rendered {kind} is in frame and matches the registered spatial positions and annotations."
            })
        self.diagram_report = self.root / "diagram-review.json"
        self.diagram_report.write_text(json.dumps({"buildId": "design-v1", "reviewer": "test reviewer", "drawings": drawings}), encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_manifest(self, payload: dict) -> Path:
        path = self.root / "delivery-manifest.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def asset_family(self, family_id: str, priority: str, object_ids: list[str], route_ids: list[str]) -> dict:
        build_map = json.loads(self.visual_build_map.read_text(encoding="utf-8"))
        targets = {("object", value) for value in object_ids} | {("route", value) for value in route_ids}
        entries = [entry for entry in build_map["entries"] if (entry["target"]["type"], entry["target"]["id"]) in targets]
        feature_ids = [feature["id"] for entry in entries for feature in entry["features"]]
        prototype_views = []
        for view_id, view_role in (("primary", "primary"), ("oblique", "oblique"), ("side", "side"), ("joint", "joint"), ("context", "context")):
            capture_path = self.root / f"{family_id}-prototype-{view_id}.png"
            capture_path.write_bytes(png_bytes(800, 600))
            prototype_views.append({
                "id": view_id, "viewRole": view_role, "path": capture_path.name,
                "sha256": hashlib.sha256(capture_path.read_bytes()).hexdigest(),
            })
        source_path = self.root / "asset.js"
        source_path.write_text("export function buildGroundSurface(){ return true; }\n", encoding="utf-8")
        return {
            "id": family_id, "priority": priority, "objectIds": object_ids, "routeIds": route_ids,
            "visualFeatureIds": feature_ids,
            "prototype": {
                "status": "PASS", "buildId": "forms-v1",
                "representativeTarget": {"type": "object", "id": object_ids[0]} if object_ids else {"type": "route", "id": route_ids[0]},
                "component": entries[0]["implementationPlan"]["component"],
                "implementationSource": {"path": source_path.name, "sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(), "symbol": "buildGroundSurface"},
                "views": prototype_views,
                "featureReviews": [
                    {"featureId": feature_id, "status": "PASS", "observation": f"Observed the mapped {feature_id} feature in linked prototype views.",
                     "viewIds": (["primary", "side"] if feature_id == "ground-profile" else ["primary", "oblique"] if feature_id == "ground-layer" else ["primary"])}
                    for feature_id in feature_ids
                ],
            },
            "requiredChecks": [{"dimension": dimension, "criterion": f"Inspect {dimension} in applicable views"} for dimension in validate_delivery.ASSET_CHECKS_BY_PRIORITY[priority]],
        }

    def asset_stage(self, ledger_path: Path) -> dict:
        evidence = [{"path": ledger_path.relative_to(self.root).as_posix(), "sha256": hashlib.sha256(ledger_path.read_bytes()).hexdigest()}]
        for capture in self.root.glob("*-prototype-*.png"):
            evidence.append({"path": capture.name, "sha256": hashlib.sha256(capture.read_bytes()).hexdigest()})
        source_path = self.root / "asset.js"
        evidence.append({"path": source_path.name, "sha256": hashlib.sha256(source_path.read_bytes()).hexdigest()})
        return {"buildId": "forms-v1", "evidence": evidence}

    def minimal_analysis_manifest(self) -> dict:
        return {
            "schemaVersion": 1,
            "mode": "analysis-only",
            "buildId": "design-v1",
            "sceneRegisterPath": "scene-register.json",
            "visualReferenceIndexPath": "visual-reference-index.json",
            "visualBuildMapPath": "visual-build-map.json",
            "diagramReviewReportPath": "diagram-review.json",
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
                    "evidence": [
                        {"path": "scene-register.json", "sha256": self.register_digest},
                        {"path": "visual-reference-index.json", "sha256": self.reference_index_digest},
                        {"path": "visual-build-map.json", "sha256": self.visual_build_map_digest},
                        {"path": "diagram-review.json", "sha256": hashlib.sha256(self.diagram_report.read_bytes()).hexdigest()},
                        *[{"path": name, "sha256": hashlib.sha256((self.root / name).read_bytes()).hexdigest()} for name in ("drawing-site-plan.svg", "drawing-site-plan.png", "drawing-section-main.svg", "drawing-section-main.png")],
                    ],
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

    def test_visual_reference_index_requires_global_plan_and_object_coverage(self) -> None:
        index = json.loads(self.reference_index.read_text(encoding="utf-8"))
        index["references"] = [item for item in index["references"] if item["id"] != "ground-detail"]
        self.reference_index.write_text(json.dumps(index), encoding="utf-8")
        stage = {"evidence": [
            {"path": "visual-reference-index.json", "sha256": hashlib.sha256(self.reference_index.read_bytes()).hexdigest()},
        ]}
        issues: list[str] = []
        validate_delivery.validate_visual_reference_index(
            self.root, "scene-register.json", "visual-reference-index.json", stage, issues,
        )
        self.assertTrue(any("object/route-focused reference for object:ground" in issue for issue in issues))

    def test_visual_reference_index_rejects_stale_image_hashes(self) -> None:
        index = json.loads(self.reference_index.read_text(encoding="utf-8"))
        index["references"][0]["sha256"] = "0" * 64
        self.reference_index.write_text(json.dumps(index), encoding="utf-8")
        stage = {"evidence": [
            {"path": "visual-reference-index.json", "sha256": hashlib.sha256(self.reference_index.read_bytes()).hexdigest()},
        ]}
        issues: list[str] = []
        validate_delivery.validate_visual_reference_index(
            self.root, "scene-register.json", "visual-reference-index.json", stage, issues,
        )
        self.assertTrue(any("sha256 must match" in issue for issue in issues))

    def test_visual_build_map_requires_reference_to_buildable_feature_coverage(self) -> None:
        payload = json.loads(self.visual_build_map.read_text(encoding="utf-8"))
        payload["entries"] = []
        self.visual_build_map.write_text(json.dumps(payload), encoding="utf-8")
        stage = {"buildId": "design-v1", "evidence": [
            {"path": "visual-build-map.json", "sha256": hashlib.sha256(self.visual_build_map.read_bytes()).hexdigest()},
        ]}
        issues: list[str] = []
        validate_delivery.validate_visual_build_map(
            self.root, "scene-register.json", "visual-reference-index.json", "visual-build-map.json", stage, issues,
        )
        self.assertTrue(any("entries must be a nonempty list" in issue for issue in issues))

    def test_visual_build_map_rejects_unreferenced_feature_and_vague_plan(self) -> None:
        payload = json.loads(self.visual_build_map.read_text(encoding="utf-8"))
        payload["entries"][0]["features"][0]["observation"] = "detailed object"
        payload["entries"][0]["implementationPlan"]["geometryStrategy"] = "make it detailed"
        self.visual_build_map.write_text(json.dumps(payload), encoding="utf-8")
        stage = {"buildId": "design-v1", "evidence": [
            {"path": "visual-build-map.json", "sha256": hashlib.sha256(self.visual_build_map.read_bytes()).hexdigest()},
        ]}
        issues: list[str] = []
        validate_delivery.validate_visual_build_map(
            self.root, "scene-register.json", "visual-reference-index.json", "visual-build-map.json", stage, issues,
        )
        joined = "\n".join(issues)
        self.assertIn("observation must state a specific visible observation/constraint", joined)
        self.assertIn("geometryStrategy must be concrete", joined)

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

    def test_asset_prototype_requires_a_hashed_declared_implementation_symbol(self) -> None:
        family = self.asset_family("terrain-family", "supporting", ["ground"], [])
        source_path = self.root / "asset.js"
        source_path.write_text("export function unrelatedBuilder(){ return true; }\n", encoding="utf-8")
        family["prototype"]["implementationSource"]["sha256"] = hashlib.sha256(source_path.read_bytes()).hexdigest()
        ledger_path = self.root / "asset-ledger.json"
        ledger_path.write_text(json.dumps({"families": [family]}), encoding="utf-8")
        issues: list[str] = []
        validate_delivery.validate_asset_ledger(
            self.root, "scene-register.json", "asset-ledger.json", "visual-build-map.json",
            self.asset_stage(ledger_path), issues,
        )
        self.assertTrue(any("does not declare buildGroundSurface" in issue for issue in issues))

    def test_visual_build_map_requires_component_to_be_a_code_symbol(self) -> None:
        data = json.loads(self.visual_build_map.read_text(encoding="utf-8"))
        data["entries"][0]["implementationPlan"]["component"] = "terrain plus trim construction"
        self.visual_build_map.write_text(json.dumps(data), encoding="utf-8")
        stage = {"buildId": "design-v1", "evidence": [{"path": self.visual_build_map.name, "sha256": hashlib.sha256(self.visual_build_map.read_bytes()).hexdigest()}]}
        issues: list[str] = []
        validate_delivery.validate_visual_build_map(self.root, self.register.name, self.reference_index.name, self.visual_build_map.name, stage, issues)
        self.assertTrue(any("must be one concrete code symbol" in issue for issue in issues))

    def test_asset_ledger_maps_every_renderable_registered_object_to_a_quality_family(self) -> None:
        ledger = {"families": [self.asset_family("terrain-family", "supporting", ["ground"], [])]}
        ledger_path = self.root / "asset-ledger.json"
        ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
        stage = self.asset_stage(ledger_path)
        issues: list[str] = []
        family_ids = validate_delivery.validate_asset_ledger(self.root, "scene-register.json", "asset-ledger.json", "visual-build-map.json", stage, issues)
        self.assertEqual({"terrain-family"}, family_ids)
        self.assertEqual([], issues)

    def test_asset_ledger_blocks_detail_expansion_without_a_complete_visual_prototype(self) -> None:
        family = self.asset_family("terrain-family", "supporting", ["ground"], [])
        family["prototype"]["featureReviews"].pop()
        ledger_path = self.root / "asset-ledger.json"
        ledger_path.write_text(json.dumps({"families": [family]}), encoding="utf-8")
        issues: list[str] = []
        validate_delivery.validate_asset_ledger(
            self.root, "scene-register.json", "asset-ledger.json", "visual-build-map.json",
            self.asset_stage(ledger_path), issues,
        )
        self.assertTrue(any("featureReviews must cover every visualFeatureId exactly" in issue for issue in issues))

    def test_asset_prototype_requires_complementary_feature_linked_views(self) -> None:
        family = self.asset_family("terrain-family", "supporting", ["ground"], [])
        family["prototype"]["featureReviews"][0]["viewIds"] = ["primary"]
        ledger_path = self.root / "asset-ledger.json"
        ledger_path.write_text(json.dumps({"families": [family]}), encoding="utf-8")
        issues: list[str] = []
        validate_delivery.validate_asset_ledger(
            self.root, "scene-register.json", "asset-ledger.json", "visual-build-map.json",
            self.asset_stage(ledger_path), issues,
        )
        self.assertTrue(any("ground-profile (silhouette) needs complementary view roles" in issue for issue in issues))

    def test_asset_prototype_requires_distinct_view_roles(self) -> None:
        family = self.asset_family("terrain-family", "supporting", ["ground"], [])
        for view in family["prototype"]["views"]:
            view["viewRole"] = "primary"
        ledger_path = self.root / "asset-ledger.json"
        ledger_path.write_text(json.dumps({"families": [family]}), encoding="utf-8")
        issues: list[str] = []
        validate_delivery.validate_asset_ledger(
            self.root, "scene-register.json", "asset-ledger.json", "visual-build-map.json",
            self.asset_stage(ledger_path), issues,
        )
        self.assertTrue(any("must use at least two distinct viewRole values" in issue for issue in issues))

    def test_asset_prototype_rejects_unlinked_or_non_image_view_evidence(self) -> None:
        family = self.asset_family("terrain-family", "supporting", ["ground"], [])
        family["prototype"]["featureReviews"][1]["viewIds"] = ["missing-view"]
        family["prototype"]["views"][0]["path"] = "asset.js"
        family["prototype"]["views"][0]["sha256"] = hashlib.sha256((self.root / "asset.js").read_bytes()).hexdigest()
        ledger_path = self.root / "asset-ledger.json"
        ledger_path.write_text(json.dumps({"families": [family]}), encoding="utf-8")
        issues: list[str] = []
        validate_delivery.validate_asset_ledger(
            self.root, "scene-register.json", "asset-ledger.json", "visual-build-map.json",
            self.asset_stage(ledger_path), issues,
        )
        joined = "\n".join(issues)
        self.assertIn("requires viewIds linked to its hashed prototype views", joined)
        self.assertIn("must be a real PNG capture", joined)

    def test_asset_ledger_cannot_omit_a_renderable_scene_object(self) -> None:
        ledger = {"families": [{
            "id": "empty-family", "priority": "ambient", "objectIds": [], "routeIds": [],
            "requiredChecks": [],
        }]}
        ledger_path = self.root / "asset-ledger.json"
        ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
        digest = hashlib.sha256(ledger_path.read_bytes()).hexdigest()
        issues: list[str] = []
        validate_delivery.validate_asset_ledger(
            self.root, "scene-register.json", "asset-ledger.json", "visual-build-map.json",
            {"buildId": "forms-v1", "evidence": [{"path": "asset-ledger.json", "sha256": digest}]}, issues,
        )
        self.assertTrue(any("unmapped renderable scene IDs" in issue for issue in issues))

    def test_final_visual_review_must_cover_every_family_and_required_check(self) -> None:
        ledger = {"families": [{
            "id": "station", "priority": "focal", "objectIds": ["ground"], "routeIds": [],
            "visualFeatureIds": ["ground-profile", "ground-layer", "ground-material"],
            "requiredChecks": [{"dimension": dimension, "criterion": f"Inspect {dimension}"}
                                for dimension in validate_delivery.ASSET_CHECKS_BY_PRIORITY["focal"]],
        }]}
        review = {"familyReviews": []}
        issues: list[str] = []
        validate_delivery.validate_asset_family_reviews(ledger, review, {"orbit-main"}, issues)
        self.assertTrue(any("familyReviews must cover every asset family" in issue for issue in issues))

    def test_family_review_accepts_complete_capture_linked_check_coverage(self) -> None:
        required = validate_delivery.ASSET_CHECKS_BY_PRIORITY["ambient"]
        ledger = {"families": [{
            "id": "foliage", "priority": "ambient", "objectIds": ["ground"], "routeIds": [],
            "visualFeatureIds": ["ground-profile", "ground-layer", "ground-material"],
            "requiredChecks": [{"dimension": dimension, "criterion": "Visible criterion"} for dimension in required],
        }]}
        review = {"familyReviews": [{
            "familyId": "foliage", "status": "PASS", "reviewedSampleIds": ["front", "orbit-back"],
            "checks": [{"dimension": dimension, "status": "PASS", "observation": f"Observed {dimension}"} for dimension in required],
            "featureReviews": [{"featureId": feature_id, "status": "PASS", "observation": f"Observed the mapped {feature_id} in the final scene.", "reviewedSampleIds": ["front"]} for feature_id in ("ground-profile", "ground-layer", "ground-material")],
        }]}
        issues: list[str] = []
        validate_delivery.validate_asset_family_reviews(ledger, review, {"front", "orbit-back"}, issues)
        self.assertEqual([], issues)

    def test_unedited_visual_review_template_cannot_pass_family_gate(self) -> None:
        template_dir = SCRIPT_DIR.parent / "assets" / "templates"
        ledger = json.loads((template_dir / "asset-ledger.template.json").read_text(encoding="utf-8"))
        review = json.loads((template_dir / "visual-review.template.json").read_text(encoding="utf-8"))
        capture_ids = set(review["reviewedSampleIds"])
        issues: list[str] = []
        validate_delivery.validate_asset_family_reviews(ledger, review, capture_ids, issues)
        self.assertTrue(any("family terrain-family must PASS" in issue for issue in issues))
        self.assertTrue(any("silhouette requires PASS with a concrete observation" in issue for issue in issues))

    def test_ambient_asset_family_keeps_full_shape_and_support_integrity_checks(self) -> None:
        ambient = set(validate_delivery.ASSET_CHECKS_BY_PRIORITY["ambient"])
        self.assertTrue({"volume-transition", "connections-support"}.issubset(ambient))
        self.assertEqual(set(validate_delivery.ASSET_CHECKS_BY_PRIORITY["focal"]), ambient)
        self.assertEqual(set(validate_delivery.ASSET_CHECKS_BY_PRIORITY["supporting"]), ambient)

    def test_asset_ledger_covers_renderable_routes_as_well_as_objects(self) -> None:
        register = json.loads(self.register.read_text(encoding="utf-8"))
        register["routes"] = [{"id": "walkway"}]
        self.register.write_text(json.dumps(register), encoding="utf-8")
        ledger = {"families": [self.asset_family("site-structure", "supporting", ["ground"], ["walkway"])]}
        ledger_path = self.root / "asset-ledger.json"
        ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
        digest = hashlib.sha256(ledger_path.read_bytes()).hexdigest()
        issues: list[str] = []
        family_ids = validate_delivery.validate_asset_ledger(
            self.root, "scene-register.json", "asset-ledger.json", "visual-build-map.json",
            self.asset_stage(ledger_path), issues,
        )
        self.assertEqual({"site-structure"}, family_ids)
        self.assertEqual([], issues)

    def test_full_production_middle_forms_release_requires_asset_ledger(self) -> None:
        data = self.minimal_analysis_manifest()
        data["mode"] = "full-production"
        data["buildId"] = "scene-v1"
        data["stages"].extend([
            {"id": "runtimePreflight", "status": "BLOCKED", "buildId": "preflight-v1", "inputs": [], "evidence": [], "preflightReport": "missing-preflight.json"},
            {"id": "spatialProxy", "status": "NOT_RUN", "buildId": "proxy-v1", "inputs": [], "evidence": []},
            {"id": "middleForms", "status": "NOT_RUN", "buildId": "forms-v1", "inputs": [], "evidence": []},
        ])
        issues = validate_delivery.validate_data(data, self.root, through="middleForms")
        self.assertTrue(any("assetLedgerPath must reference an existing project JSON file" in issue for issue in issues))

    def test_asset_ledger_evidence_must_be_hashed_by_middle_forms_stage(self) -> None:
        ledger = {"families": [self.asset_family("terrain", "supporting", ["ground"], [])]}
        ledger_path = self.root / "asset-ledger.json"
        ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
        issues: list[str] = []
        validate_delivery.validate_asset_ledger(
            self.root, "scene-register.json", "asset-ledger.json", "visual-build-map.json", {"buildId": "forms-v1", "evidence": []}, issues,
        )
        self.assertTrue(any("middleForms evidence must include assetLedgerPath" in issue for issue in issues))

    def test_mechanism_test_scope_does_not_require_the_full_production_chain(self) -> None:
        data = self.minimal_analysis_manifest()
        data["mode"] = "mechanism-test"
        data["stages"] = [{
            "id": "mechanismTest", "status": "PASS", "buildId": "design-v1",
            "evidence": [{"path": "brief.md", "sha256": self.digest}], "inputs": [],
        }]
        self.assertEqual([], validate_delivery.validate_data(data, self.root))

    def test_diagram_review_blocks_when_a_registered_section_has_no_rendered_review(self) -> None:
        data = self.minimal_analysis_manifest()
        report_path = self.root / "diagram-review.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report["drawings"] = [item for item in report["drawings"] if item["kind"] != "section"]
        report_path.write_text(json.dumps(report), encoding="utf-8")
        stage = next(item for item in data["stages"] if item["id"] == "visualAnalysis")
        for evidence in stage["evidence"]:
            if evidence["path"] == report_path.name:
                evidence["sha256"] = hashlib.sha256(report_path.read_bytes()).hexdigest()
        issues = validate_delivery.validate_data(data, self.root)
        self.assertTrue(any("requires at least one visually reviewed section" in issue for issue in issues))

    def test_diagram_review_requires_png_signature_and_size(self) -> None:
        data = self.minimal_analysis_manifest()
        preview = self.root / "drawing-site-plan.png"
        preview.write_bytes(b"not a PNG")
        report_path = self.root / "diagram-review.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        plan = next(item for item in report["drawings"] if item["kind"] == "plan")
        plan["preview"]["sha256"] = hashlib.sha256(preview.read_bytes()).hexdigest()
        report_path.write_text(json.dumps(report), encoding="utf-8")
        stage = next(item for item in data["stages"] if item["id"] == "visualAnalysis")
        for evidence in stage["evidence"]:
            if evidence["path"] == "drawing-site-plan.png": evidence["sha256"] = hashlib.sha256(preview.read_bytes()).hexdigest()
            if evidence["path"] == report_path.name: evidence["sha256"] = hashlib.sha256(report_path.read_bytes()).hexdigest()
        issues = validate_delivery.validate_data(data, self.root)
        self.assertTrue(any("must have a PNG signature and IHDR header" in issue for issue in issues))

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
            "visualReferenceIndexPath": "visual-reference-index.json",
            "spatialGatePath": "spatial-gate.json",
            "stages": [
                {"id": "direction", "status": "PASS", "buildId": "proxy-v1", "inputs": [], "evidence": [{"path": "brief.md", "sha256": digest(brief)}]},
                {"id": "visualAnalysis", "status": "PASS", "buildId": "proxy-v1", "inputs": [{"path": "brief.md", "sha256": digest(brief)}], "evidence": [{"path": "scene-register.json", "sha256": digest(register)}, {"path": "visual-reference-index.json", "sha256": digest(self.reference_index)}]},
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
            "sections": [{"id": "section-main", "plane": "vertical", "station": "x=0", "points": [[0, 0, -2], [0, 0.5, 0], [0, 0, 2]], "objectIds": ["ground"]}],
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
            "components": [{"id": "ground", "role": "proxy", "proxyRepresentation": "low-resolution central crest and continuous edge band", "visualFeatureIds": ["ground-profile", "ground-layer"]}],
        })
        put_json("proxy-review.json", {
            "result": "PASS", "buildId": "proxy-v1", "reviewedSourceSha256": source_hash,
            "formalAssetsStarted": False, "reviewedSampleIds": ["main"], "reviewer": "visual reviewer",
            "featureChecks": [
                {"featureId": "ground-profile", "status": "PASS", "observation": "The proxy retains the wide central crest in the target view.", "evidence": ["qa/proxy.png"]},
                {"featureId": "ground-layer", "status": "PASS", "observation": "The proxy shows the continuous outer edge band in the side view.", "evidence": ["qa/proxy.png"]},
            ],
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
            "inventory": "proxy-inventory.json", "reviewRecord": "proxy-review.json", "visualBuildMap": "visual-build-map.json",
        }
        gate = put_json("spatial-gate.json", gate_data)
        proxy = self.root / "proxy.html"
        proxy.write_text("neutral proxy output", encoding="utf-8")
        visual_map = json.loads(self.visual_build_map.read_text(encoding="utf-8"))
        visual_map["buildId"] = "analysis-v1"
        self.visual_build_map.write_text(json.dumps(visual_map), encoding="utf-8")
        diagram_report = json.loads(self.diagram_report.read_text(encoding="utf-8"))
        diagram_report["buildId"] = "analysis-v1"
        self.diagram_report.write_text(json.dumps(diagram_report), encoding="utf-8")
        diagram_evidence = [ref(self.diagram_report)] + [ref(self.root / name) for name in ("drawing-site-plan.svg", "drawing-site-plan.png", "drawing-section-main.svg", "drawing-section-main.png")]
        data = {
            "schemaVersion": 1, "mode": "spatial-handoff", "buildId": "proxy-v1",
            "sceneRegisterPath": "design/scene-register.json", "visualReferenceIndexPath": "visual-reference-index.json", "visualBuildMapPath": "visual-build-map.json", "diagramReviewReportPath": "diagram-review.json", "spatialGatePath": "spatial-gate.json",
            "stages": [
                {"id": "direction", "status": "PASS", "buildId": "proxy-v1", "inputs": [], "evidence": [ref(brief)]},
                {"id": "visualAnalysis", "status": "PASS", "buildId": "analysis-v1", "inputs": [ref(brief)], "evidence": [ref(simple_register), ref(self.reference_index), ref(self.visual_build_map), *diagram_evidence]},
                {"id": "runtimePreflight", "status": "PASS", "buildId": "preflight-v1", "inputs": [ref(simple_register)], "evidence": [ref(preflight_report), ref(preflight_capture)], "preflightReport": "qa/preflight.json"},
                {"id": "spatialProxy", "status": "PASS", "buildId": "proxy-v1", "inputs": [ref(simple_register), ref(self.visual_build_map)], "evidence": [ref(gate), ref(proxy)]},
            ],
        }
        self.assertEqual([], validate_delivery.validate_data(data, self.root))
        data["stages"][-1]["inputs"] = [ref(simple_register)]
        self.assertTrue(any("spatialProxy inputs must include visualBuildMapPath" in issue for issue in validate_delivery.validate_data(data, self.root)))

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
