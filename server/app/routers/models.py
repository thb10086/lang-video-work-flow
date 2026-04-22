"""Model CRUD + param schema endpoints.

所有模型数据通过 ModelService 读写，list 接口走 Redis 缓存。
"""

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.redis import get_redis
from app.db.session import get_db
from app.schemas.ai_model import (
    AiModelCreate,
    AiModelUpdate,
    AiModelResponse,
    AiModelListResponse,
)
from app.schemas.common import SuccessResponse
from app.services.model_service import ModelService

router = APIRouter(prefix="/api/models", tags=["models"])


def _get_service(
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
) -> ModelService:
    return ModelService(db, redis=redis)


@router.get("", response_model=SuccessResponse[AiModelListResponse])
async def list_models(
    capability: str | None = None,
    svc: ModelService = Depends(_get_service),
):
    """获取可用模型列表（含 param_schema），支持按 capability 筛选。优先走 Redis 缓存。"""
    rows = await svc.list_models(capability=capability)
    items = [AiModelResponse.model_validate(r) for r in rows]
    return SuccessResponse(data=AiModelListResponse(items=items, total=len(items)))


@router.get("/{model_id}", response_model=SuccessResponse[AiModelResponse])
async def get_model(model_id: str, svc: ModelService = Depends(_get_service)):
    """获取单个模型详情"""
    model = await svc.get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model not found: {model_id}")
    return SuccessResponse(data=AiModelResponse.model_validate(model))


@router.get("/{model_id}/schema")
async def get_model_schema(model_id: str, svc: ModelService = Depends(_get_service)):
    """获取模型参数 schema（前端动态渲染表单用）- 返回 ParamField[]，保持向后兼容。"""
    model = await svc.get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model not found: {model_id}")
    schema = await svc.get_param_schema(model_id)
    return SuccessResponse(data=schema)


@router.get("/{model_id}/params")
async def get_model_params(model_id: str, svc: ModelService = Depends(_get_service)):
    """获取模型参数 schema + 版本 (结构化输出，Agent 工具 get_model_params 使用)。"""
    model = await svc.get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model not found: {model_id}")
    schema = await svc.get_param_schema(model_id)
    return SuccessResponse(
        data={
            "model_id": model_id,
            "schema": schema,
            "schema_version": getattr(model, "schema_version", 1) or 1,
        }
    )


@router.post("", response_model=SuccessResponse[AiModelResponse])
async def create_model(body: AiModelCreate, svc: ModelService = Depends(_get_service)):
    """新增模型"""
    data = body.model_dump()
    data["param_schema"] = [p.model_dump() for p in body.param_schema]
    model = await svc.create_model(data)
    return SuccessResponse(data=AiModelResponse.model_validate(model))


@router.put("/{db_id}", response_model=SuccessResponse[AiModelResponse])
async def update_model(
    db_id: int,
    body: AiModelUpdate,
    svc: ModelService = Depends(_get_service),
):
    """更新模型"""
    data = body.model_dump(exclude_none=True)
    if "param_schema" in data and data["param_schema"] is not None:
        data["param_schema"] = [p.model_dump() if hasattr(p, "model_dump") else p for p in data["param_schema"]]
    model = await svc.update_model(db_id, data)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return SuccessResponse(data=AiModelResponse.model_validate(model))


@router.delete("/{db_id}")
async def delete_model(db_id: int, svc: ModelService = Depends(_get_service)):
    """软删除模型"""
    ok = await svc.delete_model(db_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Model not found")
    return SuccessResponse(message="deleted")
