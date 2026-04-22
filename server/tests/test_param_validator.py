"""
Unit tests for ParamValidator.

Uses synthetic schemas — no DB dependency.
"""

from __future__ import annotations

import pytest

from app.services.param_validator import (
    ParamValidationError,
    validate_params,
)


# ── Fixtures: synthetic schemas ──

SEEDANCE_SCHEMA: list[dict] = [
    {"key": "duration", "label": "时长(秒)", "type": "select",
     "options": [{"label": "5秒", "value": 5}, {"label": "10秒", "value": 10}]},
    {"key": "size", "label": "比例", "type": "select",
     "options": [{"label": "16:9", "value": "16:9"}, {"label": "9:16", "value": "9:16"}]},
    {"key": "generate_audio", "label": "有声", "type": "boolean", "default": False},
    {"key": "seed", "label": "种子", "type": "number", "min": 0, "max": 2147483647},
]

VEO_SCHEMA: list[dict] = [
    {"key": "duration", "label": "时长(秒)", "type": "select",
     "options": [{"label": "8秒", "value": 8}]},
    {"key": "aspect_ratio", "label": "比例", "type": "select",
     "options": [{"label": "16:9", "value": "16:9"}, {"label": "9:16", "value": "9:16"}]},
]

REQUIRED_SCHEMA: list[dict] = [
    {"key": "style", "label": "风格", "type": "select", "required": True,
     "options": [{"label": "A", "value": "a"}, {"label": "B", "value": "b"}]},
]


class TestValidateParamsHappyPath:
    def test_empty_schema_returns_input(self):
        clean, viol = validate_params([], {"anything": 1})
        # unknown keys dropped by default
        assert clean == {}
        assert viol == []

    def test_all_valid_passes(self):
        clean, viol = validate_params(
            SEEDANCE_SCHEMA,
            {"duration": 5, "size": "16:9", "generate_audio": True, "seed": 42},
        )
        assert clean == {"duration": 5, "size": "16:9", "generate_audio": True, "seed": 42}
        assert viol == []

    def test_reserved_keys_passthrough(self):
        clean, viol = validate_params(
            SEEDANCE_SCHEMA,
            {"prompt": "hello", "images": ["url1"], "duration": 5},
        )
        assert clean == {"prompt": "hello", "images": ["url1"], "duration": 5}
        assert viol == []

    def test_boolean_coercion_from_string(self):
        clean, viol = validate_params(
            SEEDANCE_SCHEMA,
            {"generate_audio": "true"},
        )
        assert clean["generate_audio"] is True
        assert viol == []


class TestValidateParamsViolations:
    def test_unknown_param_dropped_non_strict(self):
        # Request mixes Seedance-only flag for a VEO-like schema
        clean, viol = validate_params(
            VEO_SCHEMA,
            {"duration": 8, "generate_audio": True},
        )
        assert "generate_audio" not in clean
        assert clean == {"duration": 8}
        assert viol == []  # silent drop by default

    def test_unknown_param_violation_strict(self):
        clean, viol = validate_params(
            VEO_SCHEMA,
            {"duration": 8, "generate_audio": True},
            strict_unknown=True,
        )
        assert "generate_audio" not in clean
        assert len(viol) == 1
        assert viol[0]["error"] == "unknown_param"
        assert viol[0]["field"] == "generate_audio"

    def test_invalid_enum_rejected(self):
        clean, viol = validate_params(
            SEEDANCE_SCHEMA,
            {"size": "21:9"},  # not in options
        )
        assert "size" not in clean
        assert len(viol) == 1
        assert viol[0]["error"] == "invalid_enum"
        assert viol[0]["field"] == "size"
        assert "16:9" in viol[0]["allowed"]

    def test_out_of_range_max(self):
        clean, viol = validate_params(
            SEEDANCE_SCHEMA,
            {"seed": 9999999999},  # > 2147483647
        )
        assert "seed" not in clean
        assert len(viol) == 1
        assert viol[0]["error"] == "out_of_range"
        assert viol[0]["max"] == 2147483647

    def test_out_of_range_min(self):
        clean, viol = validate_params(
            SEEDANCE_SCHEMA,
            {"seed": -10},
        )
        assert "seed" not in clean
        assert len(viol) == 1
        assert viol[0]["error"] == "out_of_range"
        assert viol[0]["min"] == 0

    def test_not_a_number(self):
        clean, viol = validate_params(
            SEEDANCE_SCHEMA,
            {"seed": "abc"},
        )
        assert len(viol) == 1
        assert viol[0]["error"] == "not_a_number"

    def test_missing_required(self):
        clean, viol = validate_params(REQUIRED_SCHEMA, {})
        assert len(viol) == 1
        assert viol[0]["error"] == "missing_required"
        assert viol[0]["field"] == "style"

    def test_required_empty_string_violates(self):
        clean, viol = validate_params(REQUIRED_SCHEMA, {"style": ""})
        assert any(v["error"] == "missing_required" for v in viol)


class TestParamValidationError:
    def test_error_carries_model_id_and_detail(self):
        err = ParamValidationError("veo3.1-fast", [{"error": "invalid_enum", "field": "x"}])
        detail = err.to_http_detail()
        assert detail["error"] == "invalid_params"
        assert detail["model"] == "veo3.1-fast"
        assert len(detail["violations"]) == 1
