"""model.* tools — query the AI model registry (`ai_models` table).

Two tools:
  - model.list({capability?})
  - model.get_params({model_id})

Both wrap the existing `ModelService` from `app/services/model_service.py`,
returning structured ToolResults instead of free-form strings.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.tool_registry import Tool, get_registry
from app.agents.types import ToolResult
from app.db.redis import get_redis
from app.services.model_service import ModelService


async def _handle_list(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    db: AsyncSession = ctx["db"]
    capability = args.get("capability")
    redis = await get_redis()
    svc = ModelService(db, redis=redis)
    rows = await svc.list_models(capability=capability)
    items = [
        {
            "model_id": r["model_id"],
            "name": r.get("name"),
            "provider": r.get("provider"),
            "capability": r.get("capability"),
        }
        for r in rows
    ]
    return ToolResult(ok=True, data={"items": items, "total": len(items)})


async def _handle_get_params(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    db: AsyncSession = ctx["db"]
    model_id = str(args.get("model_id") or "").strip()
    if not model_id:
        return ToolResult.failure("missing_args", "model_id is required")
    redis = await get_redis()
    svc = ModelService(db, redis=redis)
    try:
        schema = await svc.get_model_schema(model_id)
    except Exception as exc:  # noqa: BLE001
        return ToolResult.failure(
            "model_not_found",
            f"未找到模型 {model_id}: {exc}",
            recoverable=False,
        )
    return ToolResult(
        ok=True,
        data={"model_id": model_id, "schema": schema},
    )


def register() -> None:
    r = get_registry()
    r.register(Tool(
        name="model.list",
        description="查询当前已注册的 AI 模型。可按 capability=text/image/video/audio 过滤。",
        parameters={
            "type": "object",
            "properties": {
                "capability": {
                    "type": "string",
                    "enum": ["text", "image", "video", "audio", "character"],
                },
            },
        },
        handler=_handle_list,
        tier="tier3",
        risk_level="safe",
        scope="server",
        aliases=("list_models",),
    ))

    r.register(Tool(
        name="model.get_params",
        description="获取某个模型的完整参数 schema（含 enum / range / required 标记）。",
        parameters={
            "type": "object",
            "properties": {
                "model_id": {"type": "string"},
            },
            "required": ["model_id"],
        },
        handler=_handle_get_params,
        tier="tier3",
        risk_level="safe",
        scope="server",
        aliases=("get_model_params",),
    ))
