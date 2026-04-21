"""
T1-04: Health + Generate + Upload + Task API 测试

测试覆盖:
  - GET /health
  - POST /api/generate/image — 参数校验 + 错误处理
  - POST /api/generate/video — 参数校验
  - POST /api/generate/chat — 参数校验
  - GET /api/tasks/{task_id} — 404
  - POST /api/upload/image — COS 参数校验
  - 前端→后端 API 契约验证 (schema field names)
"""


class TestHealth:

    def test_health_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["service"] == "prism-ai-server"


class TestGenerateImageAPI:

    def test_missing_model_id(self, client):
        """缺少 model_id 应返回 422"""
        resp = client.post("/api/generate/image", json={
            "prompt": "a cat",
        })
        assert resp.status_code == 422

    def test_missing_prompt(self, client):
        resp = client.post("/api/generate/image", json={
            "model_id": "gemini-3.1-flash-image-preview",
        })
        assert resp.status_code == 422

    def test_nonexistent_model(self, client):
        """不存在的模型应 500 (ValueError inside service)"""
        resp = client.post("/api/generate/image", json={
            "model_id": "nonexistent-model",
            "prompt": "test",
        })
        assert resp.status_code == 500
        assert "not found" in resp.json()["detail"].lower()


class TestGenerateVideoAPI:

    def test_missing_fields(self, client):
        resp = client.post("/api/generate/video", json={})
        assert resp.status_code == 422

    def test_nonexistent_model(self, client):
        resp = client.post("/api/generate/video", json={
            "model_id": "nonexistent",
            "prompt": "test",
        })
        assert resp.status_code == 500


class TestChatAPI:

    def test_missing_fields(self, client):
        resp = client.post("/api/generate/chat", json={})
        assert resp.status_code == 422

    def test_nonexistent_model(self, client):
        resp = client.post("/api/generate/chat", json={
            "model_id": "nonexistent",
            "prompt": "test",
        })
        assert resp.status_code == 500


class TestTaskAPI:

    def test_nonexistent_task(self, client):
        resp = client.get("/api/tasks/nonexistent-task-id")
        assert resp.status_code == 404


class TestUploadAPI:

    def test_upload_requires_data(self, client):
        resp = client.post("/api/upload/image", json={})
        assert resp.status_code == 422


class TestAPIContract:
    """验证前端 backend.ts 和后端 schema 的字段一致性"""

    def test_model_response_fields(self, client):
        """确认 /api/models 返回的字段与前端 AiModelResponse 接口匹配"""
        resp = client.get("/api/models?capability=video")
        items = resp.json()["data"]["items"]
        assert len(items) > 0
        m = items[0]
        expected_fields = {
            "id", "model_id", "name", "provider",
            "capability", "param_schema", "is_enabled",
            "sort_order", "created_at", "updated_at",
        }
        for field in expected_fields:
            assert field in m, f"Missing field: {field}"

    def test_model_list_response_shape(self, client):
        """确认列表响应有 items 和 total"""
        resp = client.get("/api/models")
        data = resp.json()["data"]
        assert "items" in data
        assert "total" in data
        assert data["total"] == len(data["items"])

    def test_channel_list_response_shape(self, client):
        resp = client.get("/api/channels")
        data = resp.json()["data"]
        assert "items" in data
        assert "total" in data
        ch = data["items"][0]
        expected = {"id", "channel_id", "name", "adapter_type", "is_enabled"}
        for f in expected:
            assert f in ch, f"Missing field: {f}"
