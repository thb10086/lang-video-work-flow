"""
Tests for media_url_normalizer — base64 / data URL → COS URL.

This is the central fix for character/scene/logo drift: adapters drop non-URL
references silently, which used to cause i2v models to degrade to t2v.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.services.media_url_normalizer import (
    SINGLE_IMAGE_PARAM_KEYS,
    _is_uploadable,
    _is_url,
    normalize_image_list,
    normalize_params_inplace,
)


# ── small base64 PNG (1x1 transparent) — long enough to pass _is_uploadable ──
_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    "AAAABJRU5ErkJggg==AAAABJRU5ErkJgg=="
)
_DATA_URL = f"data:image/png;base64,{_B64}"
_HTTPS_URL = "https://example.com/image.png"
_HTTP_URL = "http://example.com/image.png"


class TestPredicates:
    def test_is_url_https(self):
        assert _is_url(_HTTPS_URL)

    def test_is_url_http(self):
        assert _is_url(_HTTP_URL)

    def test_is_url_rejects_data(self):
        assert not _is_url(_DATA_URL)

    def test_is_url_rejects_b64(self):
        assert not _is_url(_B64)

    def test_is_url_rejects_non_string(self):
        assert not _is_url(None)
        assert not _is_url(123)

    def test_is_uploadable_data_url(self):
        assert _is_uploadable(_DATA_URL)

    def test_is_uploadable_raw_b64(self):
        assert _is_uploadable(_B64)

    def test_is_uploadable_rejects_url(self):
        assert not _is_uploadable(_HTTPS_URL)

    def test_is_uploadable_rejects_short(self):
        assert not _is_uploadable("short")

    def test_is_uploadable_rejects_text(self):
        assert not _is_uploadable("just a regular sentence with words" * 10)


@pytest.mark.asyncio
class TestNormalizeImageList:
    async def test_empty_input(self):
        assert await normalize_image_list(None) == []
        assert await normalize_image_list([]) == []

    async def test_passes_through_urls_without_uploading(self):
        # When all inputs are URLs, cos_service must NOT be called.
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = True
            cos.upload = AsyncMock()
            result = await normalize_image_list([_HTTPS_URL, _HTTP_URL])
            assert result == [_HTTPS_URL, _HTTP_URL]
            cos.upload.assert_not_called()

    async def test_uploads_base64(self):
        uploaded_url = "https://cos.example.com/uploaded.png"
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = True
            cos.upload = AsyncMock(return_value={"url": uploaded_url, "key": "k"})
            result = await normalize_image_list([_DATA_URL])
            assert result == [uploaded_url]
            cos.upload.assert_called_once_with(_DATA_URL)

    async def test_mixed_url_and_base64(self):
        """Order must be preserved (i2v depends on first-image semantics)."""
        uploaded = "https://cos.example.com/u.png"
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = True
            cos.upload = AsyncMock(return_value={"url": uploaded, "key": "k"})
            result = await normalize_image_list([_HTTPS_URL, _DATA_URL, _HTTP_URL])
            assert result == [_HTTPS_URL, uploaded, _HTTP_URL]

    async def test_drops_failed_upload(self):
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = True
            cos.upload = AsyncMock(side_effect=RuntimeError("network down"))
            result = await normalize_image_list([_HTTPS_URL, _DATA_URL])
            # URL kept, base64 dropped (since upload raised)
            assert result == [_HTTPS_URL]

    async def test_drops_when_cos_not_ready(self):
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = False
            cos.upload = AsyncMock()
            result = await normalize_image_list([_HTTPS_URL, _DATA_URL])
            assert result == [_HTTPS_URL]
            cos.upload.assert_not_called()

    async def test_drops_garbage_strings(self):
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = True
            cos.upload = AsyncMock()
            # Short non-URL strings that don't look like base64 are silently dropped
            result = await normalize_image_list(["hi", "", None, "  "])
            assert result == []
            cos.upload.assert_not_called()


@pytest.mark.asyncio
class TestNormalizeParamsInplace:
    async def test_none_or_empty_is_noop(self):
        await normalize_params_inplace(None)  # must not raise
        params: dict = {}
        await normalize_params_inplace(params)
        assert params == {}

    async def test_passes_through_urls(self):
        params = {
            "first_frame": _HTTPS_URL,
            "input_reference": _HTTPS_URL,
            "image": _HTTP_URL,
        }
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = True
            cos.upload = AsyncMock()
            await normalize_params_inplace(params)
            cos.upload.assert_not_called()
            assert params["first_frame"] == _HTTPS_URL
            assert params["input_reference"] == _HTTPS_URL
            assert params["image"] == _HTTP_URL

    async def test_uploads_base64_single_image_fields(self):
        uploaded = "https://cos.example.com/u.png"
        params = {
            "first_frame": _DATA_URL,
            "input_reference": _DATA_URL,
            "prompt": "unrelated text field",  # should not be touched
        }
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = True
            cos.upload = AsyncMock(return_value={"url": uploaded, "key": "k"})
            await normalize_params_inplace(params)
            assert params["first_frame"] == uploaded
            assert params["input_reference"] == uploaded
            # untouched
            assert params["prompt"] == "unrelated text field"

    async def test_drops_failed_upload(self):
        params = {"first_frame": _DATA_URL, "duration": 12}
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = True
            cos.upload = AsyncMock(side_effect=RuntimeError("400 bad"))
            await normalize_params_inplace(params)
            # field is removed so adapter doesn't get a stale base64
            assert "first_frame" not in params
            # other fields untouched
            assert params["duration"] == 12

    async def test_camelcase_keys_covered(self):
        """Front-end sometimes emits camelCase; both spellings must be normalized."""
        # Sanity: SINGLE_IMAGE_PARAM_KEYS includes both snake and camel variants
        assert "first_frame" in SINGLE_IMAGE_PARAM_KEYS
        assert "firstFrame" in SINGLE_IMAGE_PARAM_KEYS
        assert "inputReference" in SINGLE_IMAGE_PARAM_KEYS

        uploaded = "https://cos.example.com/u.png"
        params = {"firstFrame": _DATA_URL, "inputReference": _DATA_URL}
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = True
            cos.upload = AsyncMock(return_value={"url": uploaded, "key": "k"})
            await normalize_params_inplace(params)
            assert params["firstFrame"] == uploaded
            assert params["inputReference"] == uploaded

    async def test_character_url_not_normalized(self):
        """character_url is sora's vector_id, not an image — must not be uploaded."""
        params = {"character_url": "sora_char_xyz123", "characterUrl": "sora_char_abc"}
        with patch("app.services.media_url_normalizer.cos_service") as cos:
            cos.ready = True
            cos.upload = AsyncMock()
            await normalize_params_inplace(params)
            cos.upload.assert_not_called()
            # values preserved as-is
            assert params["character_url"] == "sora_char_xyz123"
            assert params["characterUrl"] == "sora_char_abc"
