#!/usr/bin/env python3
"""Regression tests for explicit shared-field producers and consumers."""
from __future__ import annotations

import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "validate_scene_register.py"


def register_fixture() -> dict:
    return {
        "world": {"units": "m", "up": "Y", "origin": "site center", "axes": {"x": "east", "z": "north"}},
        "evidence": {"ref-1": {"status": "Designed", "source": "brief"}},
        "objects": [{
            "id": "ground", "kind": "terrain", "status": "Designed", "geometryRole": "surface", "evidence": ["ref-1"],
            "anchor": {"space": "world", "xyz": [0, 0, 0]},
            "bounds": {"size": [10, 2, 10], "center": "anchor"}, "baseY": -1, "topY": 1,
            "fieldEvidence": {"topY": {"status": "Designed", "sourceIds": ["ref-1"], "confidence": "high"}},
            "ports": [], "relations": [],
        }],
        "routes": [], "sections": [],
        "sharedDrivers": [{
            "id": "wetness-field", "meaning": "distance-decayed wetness from the water edge",
            "coordinateSpace": "world", "units": "unitless",
            "producer": {"kind": "function", "ref": "fields.mjs", "symbol": "wetnessAt(x,z)"},
            "evidence": ["ref-1"],
            "consumers": [
                {"id": "bank-profile", "system": "geometry", "output": "shoreline profile"},
                {"id": "plant-density", "system": "distribution", "output": "instance density"},
                {"id": "stone-roughness", "system": "material", "output": "roughness region"},
            ],
        }],
    }


class SharedDriverRegisterTests(unittest.TestCase):
    def run_validator(self, mutate=None) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "register.json"
            data = register_fixture()
            if mutate:
                mutate(data)
            path.write_text(json.dumps(data), encoding="utf-8")
            result = subprocess.run(["python3", str(SCRIPT), str(path)], text=True, capture_output=True, check=False)
            return result.returncode, result.stdout + result.stderr

    def test_valid_shared_driver_with_three_consumer_systems_passes(self):
        code, output = self.run_validator()
        self.assertEqual(code, 0, output)

    def test_shared_driver_requires_multiple_declared_consumers(self):
        def mutate(data):
            data["sharedDrivers"][0]["consumers"] = data["sharedDrivers"][0]["consumers"][:1]
        code, output = self.run_validator(mutate)
        self.assertNotEqual(code, 0)
        self.assertIn("at least two consumers", output)

    def test_shared_driver_rejects_duplicate_consumer_ids(self):
        def mutate(data):
            data["sharedDrivers"][0]["consumers"][1]["id"] = "bank-profile"
        code, output = self.run_validator(mutate)
        self.assertNotEqual(code, 0)
        self.assertIn("duplicate consumer id", output)

    def test_shared_driver_requires_consumer_system_and_output(self):
        def mutate(data):
            data["sharedDrivers"][0]["consumers"][2].pop("system")
        code, output = self.run_validator(mutate)
        self.assertNotEqual(code, 0)
        self.assertIn("system and output", output)

    def test_plan_geometry_distinguishes_walkable_surface_and_checks_linked_port(self):
        def mutate(data):
            ground = data["objects"][0]
            ground["ports"] = [{"id": "landing", "space": "world", "at": [0, 1, 0], "role": "route-entry", "planGeometryId": "landing-deck", "evidence": ["ref-1"]}]
            ground["planGeometry"] = [{"id": "landing-deck", "role": "walkable-surface", "outlineXZ": [[-2, -2], [2, -2], [2, 2], [-2, 2]], "elevationY": 1, "evidence": ["ref-1"]}]
        code, output = self.run_validator(mutate)
        self.assertEqual(code, 0, output)

    def test_plan_geometry_rejects_route_port_outside_walkable_surface(self):
        def mutate(data):
            ground = data["objects"][0]
            ground["ports"] = [{"id": "landing", "space": "world", "at": [4, 1, 0], "role": "route-entry", "planGeometryId": "landing-deck", "evidence": ["ref-1"]}]
            ground["planGeometry"] = [{"id": "landing-deck", "role": "walkable-surface", "outlineXZ": [[-2, -2], [2, -2], [2, 2], [-2, 2]], "elevationY": 1, "evidence": ["ref-1"]}]
        code, output = self.run_validator(mutate)
        self.assertNotEqual(code, 0)
        self.assertIn("port lies outside plan geometry", output)

    def test_plan_geometry_rejects_port_inside_walkable_hole(self):
        def mutate(data):
            ground = data["objects"][0]
            ground["ports"] = [{"id": "blocked-center", "space": "world", "at": [0, 1, 0], "role": "route-entry", "planGeometryId": "ring-deck", "evidence": ["ref-1"]}]
            ground["planGeometry"] = [{"id": "ring-deck", "role": "walkable-surface", "outlineXZ": [[-3, -3], [3, -3], [3, 3], [-3, 3]], "holesXZ": [[[-1, -1], [1, -1], [1, 1], [-1, 1]]], "elevationY": 1, "evidence": ["ref-1"]}]
        code, output = self.run_validator(mutate)
        self.assertNotEqual(code, 0)
        self.assertIn("port lies outside plan geometry", output)

    def test_plan_geometry_rejects_port_at_wrong_elevation(self):
        def mutate(data):
            ground = data["objects"][0]
            ground["ports"] = [{"id": "floating-entry", "space": "world", "at": [0, 5, 0], "role": "route-entry", "planGeometryId": "landing-deck", "evidence": ["ref-1"]}]
            ground["planGeometry"] = [{"id": "landing-deck", "role": "walkable-surface", "outlineXZ": [[-2, -2], [2, -2], [2, 2], [-2, 2]], "elevationY": 1, "evidence": ["ref-1"]}]
        code, output = self.run_validator(mutate)
        self.assertNotEqual(code, 0)
        self.assertIn("port elevation does not match", output)


if __name__ == "__main__":
    unittest.main()
