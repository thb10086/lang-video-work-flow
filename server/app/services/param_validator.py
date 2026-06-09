"""
ParamValidator — 参数验证器

统一验证入口，给 VideoService / ImageService / 未来 AudioService 复用。
基于 ai_models.param_schema (ParamField[]) 做以下校验:

  1. drop-unknown: 未在 schema 声明的 key 被丢弃 (返回 removed 列表)
  2. enum: type in (select) 时值必须来自 options
  3. range: type in (slider, number) 时值必须在 [min, max] 区间
  4. required: required=True 且值缺失/空 → violation

返回 (clean_params, violations)。调用方决定是 422 拒绝还是 warn-only。
"""

from __future__ import annotations

from typing import Any, Iterable


# Fields allowed through unconditionally because they are carried at request body
# level, not part of the per-model param schema. e.g. `prompt` on video/image,
# `images` on video, `reference_images` on image. Validators should skip them.
_RESERVED_KEYS: frozenset[str] = frozenset({
    "prompt",
    "images",
    "image",
    "reference_images",
    "negative_prompt",  # common free-text sometimes outside schema
})


def _coerce_number(v: Any) -> float | None:
    try:
        if isinstance(v, bool):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _enum_values(field: dict[str, Any]) -> list[Any]:
    """Extract legal values from an enum/select field's options."""
    opts = field.get("options") or []
    values: list[Any] = []
    for opt in opts:
        if isinstance(opt, dict) and "value" in opt:
            values.append(opt["value"])
    return values


def _field_by_key(schema: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {f["key"]: f for f in schema if isinstance(f, dict) and "key" in f}


def validate_params(
    schema: list[dict[str, Any]] | None,
    params: dict[str, Any] | None,
    *,
    strict_unknown: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Validate `params` against `schema`.

    Args:
        schema: ParamField[] from ai_models.param_schema; empty list allowed (no-op).
        params: user-supplied params dict.
        strict_unknown: if True, unknown keys become violations (422). If False, they are
                        silently dropped (default — aligns with forward compat design).

    Returns:
        (clean_params, violations)
        clean_params: dict with only schema-legal keys (plus _RESERVED_KEYS passthrough)
        violations: list of { "error": "<code>", "field": "<key>", ... }
    """
    schema = schema or []
    params = params or {}
    by_key = _field_by_key(schema)

    clean: dict[str, Any] = {}
    violations: list[dict[str, Any]] = []

    # ── Pass 1: incoming fields ──
    for key, value in params.items():
        if key in _RESERVED_KEYS:
            clean[key] = value
            continue

        field = by_key.get(key)
        if field is None:
            if strict_unknown:
                violations.append({"error": "unknown_param", "field": key})
            # else: silently drop
            continue

        # null = "未填"：可选字段直接跳过；必填字段在 Pass 2 由 missing_required 报错。
        # 这避免了前端把空字段以 null 发送时被误判成 invalid_enum / not_a_number。
        if value is None and not field.get("required"):
            continue

        ftype = str(field.get("type") or "string")

        # enum check
        if ftype == "select":
            allowed = _enum_values(field)
            if value not in allowed:
                violations.append({
                    "error": "invalid_enum",
                    "field": key,
                    "value": value,
                    "allowed": allowed,
                })
                continue

        # range check (slider, number)
        if ftype in ("slider", "number"):
            num = _coerce_number(value)
            if num is None:
                violations.append({"error": "not_a_number", "field": key, "value": value})
                continue
            fmin = field.get("min")
            fmax = field.get("max")
            if fmin is not None and num < float(fmin):
                violations.append({
                    "error": "out_of_range",
                    "field": key,
                    "min": fmin,
                    "value": value,
                })
                continue
            if fmax is not None and num > float(fmax):
                violations.append({
                    "error": "out_of_range",
                    "field": key,
                    "max": fmax,
                    "value": value,
                })
                continue

        # boolean coerce (forgiving)
        if ftype == "boolean":
            if not isinstance(value, bool):
                if isinstance(value, (int, float)):
                    value = bool(value)
                elif isinstance(value, str):
                    value = value.strip().lower() in ("true", "1", "yes", "on")
                else:
                    violations.append({"error": "not_a_bool", "field": key, "value": value})
                    continue

        clean[key] = value

    # ── Pass 2: required fields ──
    for field in schema:
        key = field.get("key")
        if not key or not field.get("required"):
            continue
        if key not in clean or clean[key] in (None, ""):
            violations.append({"error": "missing_required", "field": key})

    return clean, violations


class ParamValidationError(Exception):
    """Raised by services when params fail validation; caller translates to HTTP 422."""

    def __init__(self, model_id: str, violations: list[dict[str, Any]]):
        self.model_id = model_id
        self.violations = violations
        super().__init__(f"Invalid params for model {model_id}: {violations}")

    def to_http_detail(self) -> dict[str, Any]:
        return {
            "error": "invalid_params",
            "model": self.model_id,
            "violations": self.violations,
        }
