"""
T1-01: Models API 白盒测试

Count 断言从 `MODELS_SEED` 动态计算（避免每加一个新模型都要改测试）。
Key 身份断言保留 hardcode（保护“某个重要模型不能从 seed 被意外删除”）。

测试覆盖:
  - GET /api/models — 全量 + 按 capability 筛选
  - GET /api/models/{model_id} — 单模型 + 404
  - GET /api/models/{model_id}/schema — 参数 schema + 404
  - POST /api/models — 创建
  - PUT /api/models/{db_id} — 更新
  - DELETE /api/models/{db_id} — 软删除
  - 种子数据完整性校验
"""
from app.db.seed import MODELS_SEED

_VIDEO = [m for m in MODELS_SEED if m["capability"] == "video"]
_IMAGE = [m for m in MODELS_SEED if m["capability"] == "image"]
_TEXT  = [m for m in MODELS_SEED if m["capability"] == "text"]
_AUDIO = [m for m in MODELS_SEED if m["capability"] == "audio"]


# ═══════════════════════════════════════════════════════════
# Seed data integrity
# ═══════════════════════════════════════════════════════════

class TestSeedDataIntegrity:
    """验证 seed 脚本写入的数据完整性"""

    def test_all_models_returned(self, client):
        resp = client.get("/api/models")
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        items = body["data"]["items"]
        assert len(items) == len(MODELS_SEED)

    def test_filter_image_models(self, client):
        resp = client.get("/api/models?capability=image")
        assert resp.status_code == 200
        items = resp.json()["data"]["items"]
        assert len(items) == len(_IMAGE)
        model_ids = {m["model_id"] for m in items}
        assert "gemini-3.1-flash-image-preview" in model_ids
        assert "gemini-3-pro-image-preview" in model_ids

    def test_filter_text_models(self, client):
        resp = client.get("/api/models?capability=text")
        assert resp.status_code == 200
        items = resp.json()["data"]["items"]
        assert len(items) == len(_TEXT)
        model_ids = {m["model_id"] for m in items}
        assert "gemini-3.1-pro-preview" in model_ids
        assert "gpt-5.4" in model_ids
        assert "gpt-4o" in model_ids
        assert "claude-sonnet-4-20250514" in model_ids

    def test_filter_video_models(self, client):
        resp = client.get("/api/models?capability=video")
        assert resp.status_code == 200
        items = resp.json()["data"]["items"]
        assert len(items) == len(_VIDEO)
        model_ids = {m["model_id"] for m in items}
        # 重要 SKU：seed 保持不变的核心视频模型身份不能丢
        assert "doubao-seedance-2-0" in model_ids
        assert "veo3.1-fast" in model_ids
        assert "kling-v2-6" in model_ids  # 更名后的正式 id（旧测试写 kling-v3 过期）
        assert "sora-2-vvip" in model_ids
        assert "grok-video-3" in model_ids  # 2026-05 接入

    def test_filter_audio_models(self, client):
        resp = client.get("/api/models?capability=audio")
        assert resp.status_code == 200
        items = resp.json()["data"]["items"]
        assert len(items) == len(_AUDIO)

    def test_model_has_param_schema(self, client):
        """Seedance 2.0 应该有完整的 param_schema"""
        resp = client.get("/api/models/doubao-seedance-2-0")
        assert resp.status_code == 200
        model = resp.json()["data"]
        assert model["model_id"] == "doubao-seedance-2-0"
        assert model["capability"] == "video"
        schema = model["param_schema"]
        assert isinstance(schema, list)
        assert len(schema) >= 3
        keys = {p["key"] for p in schema}
        assert "duration" in keys
        assert "size" in keys

    def test_gemini_image_schema(self, client):
        resp = client.get("/api/models/gemini-3.1-flash-image-preview/schema")
        assert resp.status_code == 200
        schema = resp.json()["data"]
        assert isinstance(schema, list)
        keys = {p["key"] for p in schema}
        assert "aspectRatio" in keys
        assert "imageSize" in keys

    def test_model_sort_order(self, client):
        """同 capability 内按 sort_order 排序"""
        resp = client.get("/api/models?capability=text")
        items = resp.json()["data"]["items"]
        orders = [m["sort_order"] for m in items]
        assert orders == sorted(orders)


# ═══════════════════════════════════════════════════════════
# Single model CRUD
# ═══════════════════════════════════════════════════════════

class TestModelCRUD:

    def test_get_nonexistent_model(self, client):
        resp = client.get("/api/models/nonexistent-xyz")
        assert resp.status_code == 404

    def test_schema_nonexistent(self, client):
        resp = client.get("/api/models/nonexistent-xyz-999/schema")
        assert resp.status_code == 404

    def test_create_update_delete_model(self, client, db_sync):
        """CRUD 全流程"""
        # Hard-delete leftover (soft-delete keeps unique constraint)
        cur = db_sync.cursor()
        cur.execute("DELETE FROM ai_models WHERE model_id = '__test_model_crud__'")
        db_sync.commit()

        create_body = {
            "model_id": "__test_model_crud__",
            "name": "Test Model",
            "provider": "Test",
            "capability": "text",
            "param_schema": [
                {"key": "temp", "label": "Temperature", "type": "slider"}
            ],
        }
        resp = client.post("/api/models", json=create_body)
        assert resp.status_code == 200
        created = resp.json()["data"]
        db_id = created["id"]
        assert created["model_id"] == "__test_model_crud__"

        resp = client.get("/api/models/__test_model_crud__")
        assert resp.status_code == 200

        resp = client.put(f"/api/models/{db_id}", json={"name": "Updated Test"})
        assert resp.status_code == 200
        assert resp.json()["data"]["name"] == "Updated Test"

        resp = client.delete(f"/api/models/{db_id}")
        assert resp.status_code == 200

        resp = client.get("/api/models/__test_model_crud__")
        assert resp.status_code == 404

    def test_delete_nonexistent(self, client):
        resp = client.delete("/api/models/999999")
        assert resp.status_code == 404
