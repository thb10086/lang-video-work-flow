"""
CORS preflight + Agent Chat endpoint tests.

Ensures:
  1. OPTIONS preflight from both localhost and 127.0.0.1 origins returns 200
  2. GET /api/agent/config returns correct shape
  3. POST /api/agent/chat with missing body returns 422
"""


class TestCORSPreflight:
    """Verify that CORS middleware handles preflight for all common origins."""

    def _options(self, client, url, origin):
        """Send an OPTIONS preflight request with the given Origin."""
        return client._request(
            "OPTIONS",
            url,
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "content-type",
            },
        )

    def test_localhost_3000(self, client):
        r = self._options(client, "/api/models?capability=video", "http://localhost:3000")
        assert r.status_code == 200
        assert "access-control-allow-origin" in r.headers

    def test_127_0_0_1_3000(self, client):
        """127.0.0.1:3000 must also pass — this was the original bug."""
        r = self._options(client, "/api/models?capability=video", "http://127.0.0.1:3000")
        assert r.status_code == 200
        assert r.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"

    def test_localhost_5173_or_skip(self, client):
        """Port 5173 depends on .env CORS_ORIGINS — pass if present, skip if not."""
        r = self._options(client, "/api/models", "http://localhost:5173")
        if r.status_code == 400:
            import pytest
            pytest.skip("port 5173 not in CORS_ORIGINS (optional)")
        assert r.status_code == 200

    def test_127_0_0_1_5173_or_skip(self, client):
        r = self._options(client, "/api/models", "http://127.0.0.1:5173")
        if r.status_code == 400:
            import pytest
            pytest.skip("port 5173 not in CORS_ORIGINS (optional)")
        assert r.status_code == 200

    def test_disallowed_origin_gets_400(self, client):
        """An unknown origin should NOT get CORS headers (400 from middleware)."""
        r = self._options(client, "/api/models", "http://evil.example.com")
        assert r.status_code == 400

    def test_assets_preflight_ok(self, client):
        """The assets endpoint preflight was also failing."""
        r = self._options(client, "/api/assets?kind=character&limit=500", "http://localhost:3000")
        assert r.status_code == 200

    def test_agent_config_preflight_ok(self, client):
        r = self._options(client, "/api/agent/config", "http://127.0.0.1:3000")
        assert r.status_code == 200


class TestAgentConfig:
    """GET /api/agent/config should return model info without secrets."""

    def test_shape(self, client):
        r = client.get("/api/agent/config")
        assert r.status_code == 200
        data = r.json()
        assert "default_llm_model" in data
        assert "default_image_model" in data
        assert "default_video_model" in data
        assert "llm_models" in data
        assert isinstance(data["llm_models"], list)
        assert "backend_version" in data

    def test_no_secrets(self, client):
        """Config must never leak API keys."""
        r = client.get("/api/agent/config")
        text = r.text.lower()
        assert "api_key" not in text
        assert "secret" not in text


class TestAgentChatValidation:
    """POST /api/agent/chat input validation."""

    def test_missing_messages_returns_422(self, client):
        r = client.post("/api/agent/chat", json={})
        # Pydantic model requires messages field
        assert r.status_code == 422

    def test_empty_messages_accepted(self, client):
        """Empty messages list is valid schema-wise (LLM will reject it, but we test schema)."""
        r = client.post("/api/agent/chat", json={"messages": []})
        # Should reach LLM proxy and get an error, but NOT 422
        assert r.status_code != 422
