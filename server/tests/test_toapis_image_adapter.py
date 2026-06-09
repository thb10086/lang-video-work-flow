"""
toapis_adapter image 路径回归测试 — TDD 锁定 image 提交 / size 映射 / 轮询 / 重试 / 参考图过滤。

补齐现有 test_toapis_adapter.py（仅覆盖 video）的空白。

覆盖场景：
  A. 基础 image submit + size 字段透传
  B. aspectRatio fallback → size 翻译表（4 种比例）
  C. metadata 字段（resolution / quality / style）封装
  D. reference_images URL 过滤（剔除 base64/data URL/本地路径）
  E. poll 直到 completed 返回 images（含 url 与 mime_type 映射）
  F. submit 重试机制（429 → retry → 成功）
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from app.services.adapters.base import AdapterConfig
from app.services.adapters.toapis_adapter import ToApisAdapter


# ════════════════════════════════════════════════════════════════
# 通用 fixture：双路径 mock（submit + poll）
# ════════════════════════════════════════════════════════════════

class _ImageCaptured:
    """容器：持有 submit body / poll 调用次数 / 自定义响应。"""
    submit_body: dict[str, Any] | None = None
    submit_calls: int = 0
    poll_calls: int = 0


def _make_image_adapter(
    *,
    submit_response: httpx.Response | None = None,
    submit_responses: list[httpx.Response] | None = None,
    poll_responses: list[httpx.Response] | None = None,
) -> tuple[ToApisAdapter, _ImageCaptured]:
    """
    构造 adapter + MockTransport。
    submit_responses 用于覆盖默认 200 task_id 响应（多次调用按顺序消耗）。
    poll_responses 用于覆盖默认 completed 响应（多次调用按顺序消耗，最后一项重复使用）。
    """
    captured = _ImageCaptured()

    default_completed = httpx.Response(
        200,
        json={
            "id": "img_task_001",
            "status": "completed",
            "result": {
                "data": [
                    {
                        "url": "https://cdn.toapis.com/imgs/test_001.png",
                        "mimeType": "image/png",
                    }
                ]
            },
            "usage": {"prompt_tokens": 10, "image_count": 1},
        },
    )
    sub_idx = {"i": 0}
    poll_idx = {"i": 0}

    def _handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST" and req.url.path == "/v1/images/generations":
            captured.submit_calls += 1
            captured.submit_body = json.loads(req.content.decode("utf-8"))
            if submit_responses:
                resp = submit_responses[min(sub_idx["i"], len(submit_responses) - 1)]
                sub_idx["i"] += 1
                return resp
            if submit_response is not None:
                return submit_response
            return httpx.Response(
                200,
                json={"id": "img_task_001", "object": "generation.task", "status": "queued"},
            )

        if req.method == "GET" and req.url.path.startswith("/v1/images/generations/"):
            captured.poll_calls += 1
            if poll_responses:
                # last item repeats indefinitely
                resp = poll_responses[min(poll_idx["i"], len(poll_responses) - 1)]
                poll_idx["i"] += 1
                return resp
            return default_completed

        return httpx.Response(404, json={"error": "unexpected request", "path": req.url.path})

    cfg = AdapterConfig(base_url="http://mocked", api_key="key", timeout=30)
    adapter = ToApisAdapter(cfg)
    adapter._client = httpx.AsyncClient(
        base_url="http://mocked",
        transport=httpx.MockTransport(_handler),
        headers={"Authorization": "Bearer key", "Content-Type": "application/json"},
    )
    return adapter, captured


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ── autouse: 让所有 poll/retry 测试瞬间执行（mock asyncio.sleep）──
@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    """跳过 toapis adapter 内部的所有 await asyncio.sleep(...) 实际等待。"""
    async def _instant_sleep(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        "app.services.adapters.toapis_adapter.asyncio.sleep", _instant_sleep,
    )


# ════════════════════════════════════════════════════════════════
# A. 基础 image submit + size 字段透传
# ════════════════════════════════════════════════════════════════

def test_image_submit_basic_size_passthrough():
    """gpt-image-2 提交：直接传 size='1792x1024' 必须出现在 body['size']。"""
    adapter, captured = _make_image_adapter()

    async def go():
        result = await adapter.generate(
            "gpt-image-2",
            {"prompt": "Luckin coffee hero shot", "size": "1792x1024", "n": 1},
        )
        assert result.success, f"expected success, got error={result.error}"
        images = (result.data or {}).get("images") or []
        assert len(images) == 1
        assert images[0]["url"].startswith("https://cdn.toapis.com")

    _run(go())
    assert captured.submit_body is not None
    assert captured.submit_body["model"] == "gpt-image-2"
    assert captured.submit_body["prompt"] == "Luckin coffee hero shot"
    assert captured.submit_body["size"] == "1792x1024"
    assert captured.submit_body["n"] == 1


# ════════════════════════════════════════════════════════════════
# B. aspectRatio fallback → size 翻译
# ════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "aspect,expected_size",
    [
        ("1:1", "1024x1024"),
        ("16:9", "1792x1024"),
        ("9:16", "1024x1792"),
        ("4:3", "1280x1024"),
        ("3:4", "1024x1280"),
    ],
)
def test_image_submit_aspect_ratio_translation(aspect, expected_size):
    """aspectRatio 比例字段必须翻译为 toapis 接受的 NxN 字符串。"""
    adapter, captured = _make_image_adapter()

    async def go():
        result = await adapter.generate(
            "gpt-image-2",
            {"prompt": "x", "aspectRatio": aspect},
        )
        assert result.success

    _run(go())
    assert captured.submit_body["size"] == expected_size


def test_image_submit_unknown_aspect_falls_back_to_square():
    """未知比例必须 fallback 到 1024x1024（不能崩）。"""
    adapter, captured = _make_image_adapter()

    async def go():
        result = await adapter.generate("gpt-image-2", {"prompt": "x", "aspectRatio": "weird:7"})
        assert result.success

    _run(go())
    assert captured.submit_body["size"] == "1024x1024"


# ════════════════════════════════════════════════════════════════
# C. metadata 字段封装（resolution / quality / style）
# ════════════════════════════════════════════════════════════════

def test_image_submit_metadata_packaging():
    """resolution / quality / style 必须打包到 body['metadata']，None 字段不出现。"""
    adapter, captured = _make_image_adapter()

    async def go():
        result = await adapter.generate(
            "gpt-image-2",
            {
                "prompt": "x",
                "size": "1024x1024",
                "resolution": "2048",
                "quality": "high",
                # style 故意留空 → 不应出现
            },
        )
        assert result.success

    _run(go())
    md = captured.submit_body.get("metadata")
    assert md is not None
    assert md["resolution"] == "2048"
    assert md["quality"] == "high"
    assert "style" not in md


def test_image_submit_no_metadata_when_all_empty():
    """如果 resolution/quality/style 都没传，body 里不应出现 metadata 键。"""
    adapter, captured = _make_image_adapter()

    async def go():
        result = await adapter.generate("gpt-image-2", {"prompt": "x", "size": "1024x1024"})
        assert result.success

    _run(go())
    assert "metadata" not in captured.submit_body


# ════════════════════════════════════════════════════════════════
# D. reference_images URL 过滤
# ════════════════════════════════════════════════════════════════

def test_image_submit_reference_url_only():
    """toapis 仅接受 URL 引用图；base64/data:/本地路径必须被剔除并不抛错。"""
    adapter, captured = _make_image_adapter()

    async def go():
        result = await adapter.generate(
            "gpt-image-2",
            {
                "prompt": "x",
                "reference_images": [
                    "https://cdn.example/ref1.png",  # ✓ 保留
                    "http://cdn.example/ref2.jpg",   # ✓ 保留
                    "data:image/png;base64,iVBORw0KG...",  # ✗ 剔除
                    "/Users/me/local.png",            # ✗ 剔除
                    "iVBORw0KGgoAAAANSU...",          # ✗ 剔除（裸 base64）
                ],
            },
        )
        assert result.success

    _run(go())
    refs = captured.submit_body.get("reference_images")
    assert refs is not None
    assert refs == ["https://cdn.example/ref1.png", "http://cdn.example/ref2.jpg"]


def test_image_submit_no_reference_field_when_all_filtered():
    """全部 reference 都被过滤时，body 里不应出现 reference_images 键。"""
    adapter, captured = _make_image_adapter()

    async def go():
        result = await adapter.generate(
            "gpt-image-2",
            {"prompt": "x", "reference_images": ["data:image/png;base64,XYZ"]},
        )
        assert result.success

    _run(go())
    assert "reference_images" not in captured.submit_body


# ════════════════════════════════════════════════════════════════
# E. poll 路径 — pending → processing → completed
# ════════════════════════════════════════════════════════════════

def test_image_poll_progresses_through_states():
    """轮询：第一次 pending、第二次 processing、第三次 completed。最终成功返回 images。"""
    poll_responses = [
        httpx.Response(200, json={"id": "img_task_001", "status": "queued"}),
        httpx.Response(200, json={"id": "img_task_001", "status": "processing", "progress": 50}),
        httpx.Response(
            200,
            json={
                "id": "img_task_001",
                "status": "completed",
                "result": {
                    "data": [
                        {"url": "https://cdn.toapis.com/imgs/final.png", "mimeType": "image/png"},
                    ]
                },
            },
        ),
    ]
    adapter, captured = _make_image_adapter(poll_responses=poll_responses)

    async def go():
        result = await adapter.generate("gpt-image-2", {"prompt": "x", "size": "1024x1024"})
        assert result.success, f"expected success, got error={result.error}"
        images = (result.data or {}).get("images") or []
        assert images and images[0]["url"].endswith("final.png")

    _run(go())
    assert captured.poll_calls == 3, f"expected 3 polls, got {captured.poll_calls}"


def test_image_poll_returns_failed_on_failed_status():
    """provider status=failed 必须返回 success=False 而不是抛异常。"""
    poll_responses = [
        httpx.Response(200, json={"id": "img_task_001", "status": "failed", "error": "content policy"}),
    ]
    adapter, _ = _make_image_adapter(poll_responses=poll_responses)

    async def go():
        result = await adapter.generate("gpt-image-2", {"prompt": "x"})
        assert not result.success
        assert "content policy" in (result.error or "") or "failed" in (result.error or "").lower()

    _run(go())


# ════════════════════════════════════════════════════════════════
# F. submit 重试机制（429 → retry → 成功）
# ════════════════════════════════════════════════════════════════

def test_image_submit_retry_on_429():
    """429 限流应被重试；最终成功提交后正常进入 poll。"""
    submit_responses = [
        httpx.Response(429, text="rate limit exceeded"),
        httpx.Response(429, text="rate limit exceeded"),
        httpx.Response(
            200,
            json={"id": "img_task_002", "object": "generation.task", "status": "queued"},
        ),
    ]
    # mock asyncio.sleep so retry delays don't actually take 2+5 seconds
    import unittest.mock as mock_lib

    adapter, captured = _make_image_adapter(submit_responses=submit_responses)

    async def go():
        with mock_lib.patch(
            "app.services.adapters.toapis_adapter.asyncio.sleep",
            new=mock_lib.AsyncMock(return_value=None),
        ):
            result = await adapter.generate("gpt-image-2", {"prompt": "x", "size": "1024x1024"})
        assert result.success, f"expected success after retry, got error={result.error}"

    _run(go())
    assert captured.submit_calls == 3, f"expected 3 submit attempts, got {captured.submit_calls}"


def test_image_submit_gives_up_on_400():
    """400 (non-retryable) 必须立即失败、不重试。"""
    adapter, captured = _make_image_adapter(
        submit_response=httpx.Response(400, text="invalid prompt"),
    )

    async def go():
        result = await adapter.generate("gpt-image-2", {"prompt": "x"})
        assert not result.success
        assert "submit_failed" in (result.error or "")

    _run(go())
    assert captured.submit_calls == 1, f"expected single attempt for non-retryable, got {captured.submit_calls}"
