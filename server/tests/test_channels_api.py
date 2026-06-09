"""
T1-02: Channels API 白盒测试

Count 与 id 集合从 `CHANNELS_SEED` 动态计算。

测试覆盖:
  - GET /api/channels — 列表
  - GET /api/channels/{channel_id} — 单渠道 + 404
  - POST /api/channels — 创建
  - PUT /api/channels/{db_id} — 更新
  - DELETE /api/channels/{db_id} — 软删除
  - 种子渠道完整性校验
"""
from app.db.seed import CHANNELS_SEED

_SEED_IDS = {c["channel_id"] for c in CHANNELS_SEED}


class TestChannelSeedData:

    def test_all_channels(self, client):
        resp = client.get("/api/channels")
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        items = body["data"]["items"]
        assert len(items) == len(CHANNELS_SEED)
        channel_ids = {ch["channel_id"] for ch in items}
        assert channel_ids == _SEED_IDS

    def test_get_yunwu(self, client):
        resp = client.get("/api/channels/yunwu")
        assert resp.status_code == 200
        ch = resp.json()["data"]
        assert ch["name"] == "Yunwu.ai"
        assert ch["adapter_type"] == "gemini"

    def test_get_toapis(self, client):
        # apimart 已改名为 toapis（2026-05 需接入 toapis 网关）
        resp = client.get("/api/channels/toapis")
        assert resp.status_code == 200
        ch = resp.json()["data"]
        assert ch["adapter_type"] == "toapis"

    def test_get_nonexistent(self, client):
        resp = client.get("/api/channels/nonexistent")
        assert resp.status_code == 404


class TestChannelCRUD:

    def test_create_update_delete(self, client, db_sync):
        # Hard-delete leftover (soft-delete keeps unique constraint)
        cur = db_sync.cursor()
        cur.execute("DELETE FROM ai_channels WHERE channel_id = '__test_ch__'")
        db_sync.commit()

        body = {
            "channel_id": "__test_ch__",
            "name": "Test Channel",
            "base_url": "https://test.api",
            "api_key": "sk-test",
            "adapter_type": "openai",
        }
        resp = client.post("/api/channels", json=body)
        assert resp.status_code == 200
        created = resp.json()["data"]
        db_id = created["id"]
        assert created["channel_id"] == "__test_ch__"

        resp = client.put(f"/api/channels/{db_id}", json={"name": "Updated Ch"})
        assert resp.status_code == 200
        assert resp.json()["data"]["name"] == "Updated Ch"

        resp = client.delete(f"/api/channels/{db_id}")
        assert resp.status_code == 200

        resp = client.get("/api/channels/__test_ch__")
        assert resp.status_code == 404
