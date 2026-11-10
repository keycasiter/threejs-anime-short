#!/usr/bin/env python3
"""Fail-closed structural and spatial consistency check for a Stage 1 register."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

STATUSES = {"Observed", "Inferred", "Designed", "Unknown"}
GEOMETRY_ROLES = {"solid", "surface", "path", "distribution-envelope", "clearance-envelope"}
TOLERANCE = 0.02  # meters/design units; only for endpoint and extent arithmetic


def vec3(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 3 and all(
        isinstance(v, (int, float)) and math.isfinite(v) for v in value
    )


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_scene_register.py path/to/spatial-register.json", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"SCENE_REGISTER_INVALID: {exc}", file=sys.stderr)
        return 2
    if not isinstance(data, dict):
        print("SCENE_REGISTER_INVALID: root must be an object", file=sys.stderr)
        return 2

    issues: list[str] = []
    evidence = data.get("evidence")
    if not isinstance(evidence, dict) or not evidence:
        issues.append("evidence must be a non-empty ID-indexed object")
        evidence = {}
    for eid, item in evidence.items():
        if not isinstance(item, dict) or item.get("status") not in STATUSES:
            issues.append(f"evidence {eid}: missing valid status")

    objects = data.get("objects")
    routes = data.get("routes", [])
    sections = data.get("sections", [])
    if not isinstance(objects, list) or not objects:
        print("SCENE_REGISTER_INVALID: objects must be a non-empty list", file=sys.stderr)
        return 2
    if not isinstance(routes, list) or not isinstance(sections, list):
        issues.append("routes and sections must be lists when present")
        routes, sections = [], []

    object_by_id: dict[str, dict[str, Any]] = {}
    route_by_id: dict[str, dict[str, Any]] = {}
    for collection, table, label in ((objects, object_by_id, "object"), (routes, route_by_id, "route")):
        for i, item in enumerate(collection):
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"].strip():
                issues.append(f"{label}[{i}]: missing stable id")
                continue
            if item["id"] in table:
                issues.append(f"duplicate {label} id: {item['id']}")
            table[item["id"]] = item
    for collision in set(object_by_id) & set(route_by_id):
        issues.append(f"id must be globally unique across objects and routes: {collision}")

    def check_evidence(owner: str, refs: Any) -> None:
        if not isinstance(refs, list) or not refs:
            issues.append(f"{owner}: evidence must be a non-empty list")
            return
        for ref in refs:
            if ref not in evidence:
                issues.append(f"{owner}: unresolved evidence id {ref}")

    object_ports: dict[str, dict[str, dict[str, Any]]] = {}
    for oid, item in object_by_id.items():
        if item.get("status") not in STATUSES:
            issues.append(f"{oid}: invalid status")
        if item.get("geometryRole") not in GEOMETRY_ROLES:
            issues.append(f"{oid}: geometryRole must distinguish renderable geometry from constraint envelopes")
        check_evidence(oid, item.get("evidence"))
        field_evidence = item.get("fieldEvidence")
        if not isinstance(field_evidence, dict) or not field_evidence:
            issues.append(f"{oid}: fieldEvidence must identify provenance for modeled fields")
        else:
            for field, record in field_evidence.items():
                if not isinstance(record, dict) or record.get("status") not in STATUSES:
                    issues.append(f"{oid}.{field}: invalid/missing provenance status")
                    continue
                check_evidence(f"{oid}.{field}", record.get("sourceIds"))
                if record.get("confidence") not in {"high", "medium", "low"}:
                    issues.append(f"{oid}.{field}: confidence must be high, medium, or low")
        anchor = item.get("anchor", {}).get("xyz") if isinstance(item.get("anchor"), dict) else None
        bounds = item.get("bounds")
        if not vec3(anchor) or not isinstance(item.get("anchor"), dict) or item["anchor"].get("space") != "world":
            issues.append(f"{oid}: anchor.xyz must be a finite world-space vec3")
        if not isinstance(bounds, dict) or bounds.get("center") != "anchor" or not vec3(bounds.get("size")):
            issues.append(f"{oid}: bounds must declare positive size and center='anchor'")
        elif any(v <= 0 for v in bounds["size"]):
            issues.append(f"{oid}: bounds sizes must be positive")
        elif vec3(anchor):
            expected = (anchor[1] - bounds["size"][1] / 2, anchor[1] + bounds["size"][1] / 2)
            actual = (item.get("baseY"), item.get("topY"))
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in actual):
                issues.append(f"{oid}: baseY/topY must be finite")
            elif max(abs(expected[i] - actual[i]) for i in (0, 1)) > TOLERANCE:
                issues.append(f"{oid}: anchor/bounds vertical extent {expected} conflicts with baseY/topY {actual}")
        for ref in ([item.get("hostSurfaceId")] if item.get("hostSurfaceId") else []) + item.get("supportIds", []):
            if ref not in object_by_id:
                issues.append(f"{oid}: unresolved host/support object {ref}")
        ports = item.get("ports", [])
        if not isinstance(ports, list):
            issues.append(f"{oid}: ports must be a list")
            ports = []
        table: dict[str, dict[str, Any]] = {}
        for port in ports:
            if not isinstance(port, dict) or not isinstance(port.get("id"), str) or not vec3(port.get("at")) or port.get("space") != "world":
                issues.append(f"{oid}: every port needs id and finite world-space at")
                continue
            if port["id"] in table:
                issues.append(f"{oid}: duplicate port id {port['id']}")
            table[port["id"]] = port
            check_evidence(f"{oid}.{port['id']}", port.get("evidence"))
        object_ports[oid] = table
        for relation in item.get("relations", []):
            target = relation.get("targetId") if isinstance(relation, dict) else None
            if target not in object_by_id:
                issues.append(f"{oid}: unresolved relation target {target}")
            via = relation.get("via") if isinstance(relation, dict) else None
            if via is not None and via not in route_by_id:
                issues.append(f"{oid}: unresolved relation route {via}")
            if isinstance(relation, dict):
                check_evidence(f"{oid}.{relation.get('id', 'relation')}", relation.get("evidence"))

    route_ports: dict[str, dict[str, dict[str, Any]]] = {
        rid: {p.get("id"): p for p in route.get("ports", []) if isinstance(p, dict) and isinstance(p.get("id"), str)}
        for rid, route in route_by_id.items()
    }
    for rid, route in route_by_id.items():
        check_evidence(rid, route.get("evidence"))
        if route.get("coordinateSpace") != "world":
            issues.append(f"{rid}: coordinateSpace must be world")
        points = route.get("points")
        if not isinstance(points, list) or len(points) < 2 or any(not vec3(p) for p in points):
            issues.append(f"{rid}: requires at least two finite world-space points")
            points = []
        if route.get("hostSurfaceId") and route["hostSurfaceId"] not in object_by_id:
            issues.append(f"{rid}: unresolved host surface {route['hostSurfaceId']}")
        ports = route.get("ports", [])
        if not isinstance(ports, list):
            issues.append(f"{rid}: ports must be a list")
            ports = []
        table: dict[str, dict[str, Any]] = {}
        for port in ports:
            if not isinstance(port, dict) or not isinstance(port.get("id"), str) or not vec3(port.get("at")) or port.get("space") != "world":
                issues.append(f"{rid}: every route port needs id and finite world-space at")
                continue
            if port["id"] in table:
                issues.append(f"{rid}: duplicate port id {port['id']}")
            table[port["id"]] = port
            check_evidence(f"{rid}.{port['id']}", port.get("evidence"))
        route_ports[rid] = table
        connects = route.get("connects", [])
        if not isinstance(connects, list) or len(connects) != 2:
            issues.append(f"{rid}: connects must name start and end ports in path order")
        elif len(points) >= 2:
            for index, ref in enumerate(connects):
                if not isinstance(ref, str) or "." not in ref:
                    issues.append(f"{rid}: invalid endpoint reference {ref}")
                    continue
                owner, port_id = ref.split(".", 1)
                port = object_ports.get(owner, {}).get(port_id) or route_ports.get(owner, {}).get(port_id)
                if port is None:
                    issues.append(f"{rid}: unresolved endpoint port {ref}")
                    continue
                endpoint = points[0] if index == 0 else points[-1]
                if math.dist(endpoint, port["at"]) > TOLERANCE:
                    issues.append(f"{rid}: endpoint {endpoint} does not meet {ref} at {port['at']}")

    section_ids: set[str] = set()
    for i, section in enumerate(sections):
        if not isinstance(section, dict) or not isinstance(section.get("id"), str):
            issues.append(f"section[{i}]: missing id")
            continue
        if section["id"] in section_ids:
            issues.append(f"duplicate section id: {section['id']}")
        section_ids.add(section["id"])
        for field in ("objectIds", "routeIds"):
            refs = section.get(field, [])
            if not isinstance(refs, list):
                issues.append(f"{section['id']}: {field} must be a list")
            elif any(ref not in (object_by_id if field == "objectIds" else route_by_id) for ref in refs):
                issues.append(f"{section['id']}: {field} contains unresolved/wrong-kind ids")
        points = section.get("points")
        if points is not None and (not isinstance(points, list) or len(points) < 2 or any(not vec3(p) for p in points)):
            issues.append(f"{section['id']}: section points must be finite world-space vec3s")

    shared_drivers = data.get("sharedDrivers", [])
    if not isinstance(shared_drivers, list):
        issues.append("sharedDrivers must be a list when present")
    else:
        driver_ids: set[str] = set()
        for i, driver in enumerate(shared_drivers):
            if not isinstance(driver, dict) or not isinstance(driver.get("id"), str) or not driver["id"].strip():
                issues.append(f"sharedDriver[{i}]: missing stable id")
                continue
            driver_id = driver["id"]
            if driver_id in driver_ids:
                issues.append(f"duplicate sharedDriver id: {driver_id}")
            driver_ids.add(driver_id)
            if not isinstance(driver.get("meaning"), str) or not driver["meaning"].strip():
                issues.append(f"{driver_id}: meaning is required")
            if driver.get("coordinateSpace") != "world":
                issues.append(f"{driver_id}: coordinateSpace must be world")
            if not isinstance(driver.get("units"), str) or not driver["units"].strip():
                issues.append(f"{driver_id}: units are required")
            producer = driver.get("producer")
            if not isinstance(producer, dict) or not all(
                isinstance(producer.get(key), str) and producer[key].strip()
                for key in ("kind", "ref", "symbol")
            ):
                issues.append(f"{driver_id}: producer kind, ref, and symbol are required")
            check_evidence(driver_id, driver.get("evidence"))
            consumers = driver.get("consumers")
            if not isinstance(consumers, list) or len(consumers) < 2:
                issues.append(f"{driver_id}: shared driver requires at least two consumers")
                continue
            consumer_ids: set[str] = set()
            for consumer_index, consumer in enumerate(consumers):
                if not isinstance(consumer, dict) or not isinstance(consumer.get("id"), str) or not consumer["id"].strip():
                    issues.append(f"{driver_id}: consumer {consumer_index} requires a stable id")
                    continue
                consumer_id = consumer["id"]
                if consumer_id in consumer_ids:
                    issues.append(f"{driver_id}: duplicate consumer id {consumer_id}")
                consumer_ids.add(consumer_id)
                if not isinstance(consumer.get("system"), str) or not consumer["system"].strip() or not isinstance(consumer.get("output"), str) or not consumer["output"].strip():
                    issues.append(f"{driver_id}.{consumer_id}: system and output are required")

    unknowns = data.get("unknowns", [])
    if not isinstance(unknowns, list):
        issues.append("unknowns must be a list")
    else:
        unknown_ids: set[str] = set()
        for i, item in enumerate(unknowns):
            if not isinstance(item, dict) or not all(isinstance(item.get(k), str) and item[k].strip() for k in ("id", "question", "impact")):
                issues.append(f"unknown[{i}]: id, question, and impact are required")
                continue
            if item["id"] in unknown_ids:
                issues.append(f"duplicate unknown id: {item['id']}")
            unknown_ids.add(item["id"])

    if issues:
        print("SCENE_REGISTER_BLOCKED")
        for issue in issues:
            print(f"- {issue}")
        return 1
    print(f"SCENE_REGISTER_PASS: {len(object_by_id)} objects, {len(route_by_id)} routes, {len(sections)} sections")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
