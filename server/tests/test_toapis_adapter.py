"""
toapis_adapter 字段映射回归测试 — 锁定 grok-video-3 接入引入的字段双写逻辑。

覆盖 spec agent-grok-driver 的 Requirement
"toapis_adapter 适配 Grok 字段命名差异" 的 3 个 Scenario，
+ 对 sora/seedance 的回归保护。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from app.services.adapters.base import AdapterConfig
from app.services.adapters.toapis_adapter import ToApisAdapter


# ── 共用 fixture：构造一个 adapter，并注入 MockTransport 截获提交请求体 ──

class _Captured:
    """容器，持有 mock 截获到的 body。"""
    body: dict[str, Any] | None = None


def _make_adapter() -> tuple[ToApisAdapter, _Captured]:
    """造一个 adapter，client 用 MockTransport 截获请求并返回固定的 task_id。"""
    captured = _Captured()

    def _handler(req: httpx.Request) -> httpx.Response:
        # 仅认 video submit；其它路径返回 404
        if req.url.path == "/v1/videos/generations" and req.method == "POST":
            captured.body = json.loads(req.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "id": "tsk_test_001",
                    "object": "generation.task",
                    "status": "queued",
                    "progress": 0,
                },
            )
        return httpx.Response(404, json={"error": "unexpected request"})

    cfg = AdapterConfig(base_url="http://mocked", api_key="key", timeout=30)
    adapter = ToApisAdapter(cfg)
    # 直接替换 _client 跳过延迟创建
    adapter._client = httpx.AsyncClient(
        base_url="http://mocked",
        transport=httpx.MockTransport(_handler),
        headers={"Authorization": "Bearer key", "Content-Type": "application/json"},
    )
    return adapter, captured


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ════════════════════════════════════════════════════════════════
# 6.1 Grok seconds 字段透传
# ════════════════════════════════════════════════════════════════

def test_seconds_passthrough():
    """grok-video-3 提交参数 seconds 必须出现在请求体中，且原值是字符串。"""
    adapter, captured = _make_adapter()

    async def go():
        result = await adapter._do_submit_video(
            "grok-video-3",
            {"prompt": "a sunny park", "seconds": "10", "aspect_ratio": "16:9"},
        )
        assert result.success
        assert result.task_id == "tsk_test_001"

    _run(go())
    assert captured.body is not None
    assert captured.body["model"] == "grok-video-3"
    assert captured.body["prompt"] == "a sunny park"
    assert captured.body["seconds"] == "10"  # 必须保持字符串类型
    assert captured.body["aspect_ratio"] == "16:9"
    # grok 不传 duration，不应出现
    assert "duration" not in captured.body


# ════════════════════════════════════════════════════════════════
# 6.2 images / image_urls 双写
# ════════════════════════════════════════════════════════════════

def test_images_double_write():
    """提交带 images 的请求时，body 同时包含 images 与 image_urls，值相同。"""
    adapter, captured = _make_adapter()
    urls = ["https://cos.example.com/a.png", "https://cos.example.com/b.png"]

    async def go():
        await adapter._do_submit_video(
            "grok-video-3",
            {"prompt": "x", "seconds": "6", "images": urls},
        )

    _run(go())
    assert captured.body is not None
    assert captured.body.get("images") == urls
    assert captured.body.get("image_urls") == urls
    # 两个字段是同一份内容
    assert captured.body["images"] == captured.body["image_urls"]


# ════════════════════════════════════════════════════════════════
# 6.3 Seedance 回归 — 没传 seconds 就不出现，行为不变
# ════════════════════════════════════════════════════════════════

def test_seedance_unchanged():
    """seedance 用 duration（int），body 不应出现 seconds；不传 images 时不应出现 images/image_urls。"""
    adapter, captured = _make_adapter()

    async def go():
        await adapter._do_submit_video(
            "doubao-seedance-2-0",
            {"prompt": "hi", "duration": 5, "aspect_ratio": "16:9"},
        )

    _run(go())
    assert captured.body is not None
    assert captured.body["duration"] == 5
    # 关键：不传 seconds 就不应出现（向后兼容）
    assert "seconds" not in captured.body
    # 不传 images 时也不出现这两个字段
    assert "images" not in captured.body
    assert "image_urls" not in captured.body


def test_sora_input_reference_preserved():
    """sora 用 character_url + 第一张图作 input_reference；改动后 input_reference 仍正确填充。"""
    adapter, captured = _make_adapter()
    urls = ["https://cos.example.com/first.png"]

    async def go():
        await adapter._do_submit_video(
            "sora-2-vvip",
            {"prompt": "x", "duration": 12, "images": urls},
        )

    _run(go())
    assert captured.body is not None
    # input_reference 应被自动填充为第一张图
    assert captured.body.get("input_reference") == urls[0]
    # 同时双写两个 images 字段
    assert captured.body.get("images") == urls
    assert captured.body.get("image_urls") == urls


# ════════════════════════════════════════════════════════════════
# 6.4 grok 文档限制：images 最多 3 张，超过截断
# ════════════════════════════════════════════════════════════════

def test_images_truncated_at_3():
    """传 5 张图 URL，body[images] 与 body[image_urls] 都被截断到 3，按输入顺序保留前 3。"""
    adapter, captured = _make_adapter()
    urls = [f"https://cos.example.com/{i}.png" for i in range(5)]

    async def go():
        await adapter._do_submit_video(
            "grok-video-3",
            {"prompt": "x", "seconds": "10", "images": urls},
        )

    _run(go())
    assert captured.body is not None
    assert len(captured.body["images"]) == 3
    assert captured.body["images"] == urls[:3]
    assert len(captured.body["image_urls"]) == 3
    assert captured.body["image_urls"] == urls[:3]


def test_non_url_images_filtered():
    """非 http(s) 开头的 ref（base64 / 本地路径）应被过滤；剩 0 张时不写 images/image_urls。"""
    adapter, captured = _make_adapter()

    async def go():
        await adapter._do_submit_video(
            "grok-video-3",
            {"prompt": "x", "seconds": "6", "images": [
                "data:image/png;base64,xxx",
                "/local/path.png",
                42,           # 非字符串
            ]},
        )

    _run(go())
    assert captured.body is not None
    assert "images" not in captured.body
    assert "image_urls" not in captured.body
