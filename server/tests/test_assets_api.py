"""Integration tests for /api/assets endpoints.

Uses the real DB via TestClient. Tests create/list/update/delete + variations
+ resolve + trash + soft delete. Each test cleans up its own data via the
trash endpoint or a direct delete call.

All tests run under the default user_id=1 (single-tenant placeholder).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


# ── Helpers ──

def _make_character(client: TestClient, name: str, **extra) -> dict:
    body = {
        "kind": "character",
        "name": name,
        "name_en": extra.get("name_en", name),
        "appearance": extra.get("appearance", f"{name} appearance"),
        "reference_images": extra.get("reference_images", []),
        "metadata": extra.get("metadata", {}),
    }
    if "project_id" in extra:
        body["project_id"] = extra["project_id"]
    r = client.post("/api/assets", json=body)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _make_scene(client: TestClient, name: str, **extra) -> dict:
    body = {
        "kind": "scene",
        "name": name,
        "environment": extra.get("environment", f"{name} scene"),
        "reference_images": extra.get("reference_images", []),
    }
    r = client.post("/api/assets", json=body)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _make_style(client: TestClient, name: str, **extra) -> dict:
    body = {
        "kind": "style",
        "name": name,
        "guide": extra.get("guide", f"{name} guide"),
        "reference_images": extra.get("reference_images", []),
    }
    r = client.post("/api/assets", json=body)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _purge(client: TestClient, asset_id: str) -> None:
    # idempotent cleanup
    client.delete(f"/api/assets/{asset_id}")


# ── Tests ──

class TestAssetCRUD:
    def test_create_character_with_minimal_fields(self, client: TestClient):
        body = {"kind": "character", "name": "Minimal", "appearance": "plain"}
        r = client.post("/api/assets", json=body)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["asset_id"].startswith("char_")
        assert data["kind"] == "character"
        assert data["appearance"] == "plain"
        assert data["reference_images"] == []
        assert data["variations"] == []
        assert data["appearance_version"] == 1
        _purge(client, data["asset_id"])

    def test_create_all_three_kinds(self, client: TestClient):
        c = _make_character(client, "AlphaChar")
        s = _make_scene(client, "AlphaScene")
        st = _make_style(client, "AlphaStyle")
        assert c["asset_id"].startswith("char_")
        assert s["asset_id"].startswith("scene_")
        assert st["asset_id"].startswith("style_")
        for a in (c, s, st):
            _purge(client, a["asset_id"])

    def test_list_filters_by_kind(self, client: TestClient):
        c = _make_character(client, "ListChar")
        s = _make_scene(client, "ListScene")

        chars = client.get("/api/assets", params={"kind": "character"}).json()["data"]["items"]
        scenes = client.get("/api/assets", params={"kind": "scene"}).json()["data"]["items"]

        char_ids = [x["asset_id"] for x in chars]
        scene_ids = [x["asset_id"] for x in scenes]
        assert c["asset_id"] in char_ids
        assert s["asset_id"] in scene_ids
        assert c["asset_id"] not in scene_ids

        _purge(client, c["asset_id"])
        _purge(client, s["asset_id"])

    def test_list_search_q(self, client: TestClient):
        c1 = _make_character(client, "Xyz-Alpha-1", name_en="Xyz-Alpha-1")
        c2 = _make_character(client, "Bravo-Two", name_en="Bravo-Two")

        r = client.get("/api/assets", params={"kind": "character", "q": "xyz-alpha"})
        ids = [x["asset_id"] for x in r.json()["data"]["items"]]
        assert c1["asset_id"] in ids
        assert c2["asset_id"] not in ids

        _purge(client, c1["asset_id"])
        _purge(client, c2["asset_id"])

    def test_get_asset(self, client: TestClient):
        c = _make_character(client, "GetOne", appearance="tall, red hat")
        r = client.get(f"/api/assets/{c['asset_id']}")
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["name"] == "GetOne"
        assert data["appearance"] == "tall, red hat"
        _purge(client, c["asset_id"])

    def test_get_nonexistent_returns_404(self, client: TestClient):
        r = client.get("/api/assets/char_nothing")
        assert r.status_code == 404

    def test_patch_bumps_appearance_version(self, client: TestClient):
        c = _make_character(client, "Bumpy", appearance="v1")
        assert c["appearance_version"] == 1

        r = client.patch(f"/api/assets/{c['asset_id']}", json={"appearance": "v2 updated"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["appearance"] == "v2 updated"
        assert data["appearance_version"] == 2

        # Non-content update should NOT bump version
        r = client.patch(f"/api/assets/{c['asset_id']}", json={"name": "Bumpy-renamed"})
        assert r.status_code == 200
        assert r.json()["data"]["appearance_version"] == 2

        _purge(client, c["asset_id"])

    def test_soft_delete_and_trash_and_restore(self, client: TestClient):
        c = _make_character(client, "DeleteMe")
        aid = c["asset_id"]

        # Delete
        assert client.delete(f"/api/assets/{aid}").status_code == 200

        # Not in active list
        chars = client.get("/api/assets", params={"kind": "character"}).json()["data"]["items"]
        assert aid not in [x["asset_id"] for x in chars]

        # In trash
        trash = client.get("/api/assets/trash").json()["data"]
        assert aid in [x["asset_id"] for x in trash]

        # Restore
        r = client.post(f"/api/assets/{aid}/restore")
        assert r.status_code == 200

        # Back in active list
        chars = client.get("/api/assets", params={"kind": "character"}).json()["data"]["items"]
        assert aid in [x["asset_id"] for x in chars]

        _purge(client, aid)


class TestVariations:
    def test_add_variation_bumps_version(self, client: TestClient):
        c = _make_character(client, "VarChar", appearance="default look")
        aid = c["asset_id"]
        assert c["appearance_version"] == 1

        r = client.post(
            f"/api/assets/{aid}/variations",
            json={"label": "formal", "appearance_delta": "wearing a tuxedo"},
        )
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert len(data["variations"]) == 1
        var = data["variations"][0]
        assert var["id"].startswith("var_")
        assert var["label"] == "formal"
        assert var["appearance_delta"] == "wearing a tuxedo"
        assert data["appearance_version"] == 2
        _purge(client, aid)

    def test_update_variation(self, client: TestClient):
        c = _make_character(client, "VarUpd")
        aid = c["asset_id"]
        add = client.post(f"/api/assets/{aid}/variations", json={"label": "casual"}).json()["data"]
        var_id = add["variations"][0]["id"]

        r = client.patch(
            f"/api/assets/{aid}/variations/{var_id}",
            json={"label": "formal", "appearance_delta": "updated delta"},
        )
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["variations"][0]["label"] == "formal"
        assert data["variations"][0]["appearance_delta"] == "updated delta"
        _purge(client, aid)

    def test_remove_variation(self, client: TestClient):
        c = _make_character(client, "VarRm")
        aid = c["asset_id"]
        v1 = client.post(f"/api/assets/{aid}/variations", json={"label": "a"}).json()["data"]["variations"][0]
        v2 = client.post(f"/api/assets/{aid}/variations", json={"label": "b"}).json()["data"]["variations"][0]

        r = client.delete(f"/api/assets/{aid}/variations/{v1['id']}")
        assert r.status_code == 200
        remaining = r.json()["data"]["variations"]
        assert len(remaining) == 1
        assert remaining[0]["id"] == v2["id"]
        _purge(client, aid)


class TestResolve:
    def test_resolve_without_variation(self, client: TestClient):
        c = _make_character(
            client,
            "Resolvey",
            appearance="green eyes",
            reference_images=["https://example.com/r1.png"],
        )
        aid = c["asset_id"]
        r = client.get(f"/api/assets/{aid}/resolve")
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["appearance"] == "green eyes"
        assert data["reference_images"] == ["https://example.com/r1.png"]
        assert data["variation_id"] is None
        _purge(client, aid)

    def test_resolve_with_variation_merges_appearance_and_images(self, client: TestClient):
        c = _make_character(
            client,
            "ResolveyVar",
            appearance="base appearance",
            reference_images=["https://example.com/base.png"],
        )
        aid = c["asset_id"]
        v = client.post(
            f"/api/assets/{aid}/variations",
            json={
                "label": "formal",
                "appearance_delta": "in a suit",
                "reference_images": ["https://example.com/formal.png"],
            },
        ).json()["data"]["variations"][0]

        r = client.get(f"/api/assets/{aid}/resolve", params={"variation": v["id"]})
        data = r.json()["data"]
        assert data["appearance"] == "base appearance, in a suit"
        # Variation images first, then parent's
        assert data["reference_images"] == [
            "https://example.com/formal.png",
            "https://example.com/base.png",
        ]
        assert data["variation_id"] == v["id"]
        _purge(client, aid)

    def test_resolve_unknown_variation_404(self, client: TestClient):
        c = _make_character(client, "Resolve404")
        aid = c["asset_id"]
        r = client.get(f"/api/assets/{aid}/resolve", params={"variation": "var_doesnotexist"})
        assert r.status_code == 404
        _purge(client, aid)


class TestInvalidInputs:
    def test_bad_kind_400(self, client: TestClient):
        r = client.get("/api/assets", params={"kind": "banana"})
        assert r.status_code == 400

    def test_missing_required_fields_422(self, client: TestClient):
        # appearance is required for character
        r = client.post("/api/assets", json={"kind": "character", "name": "NoApp"})
        assert r.status_code == 422
