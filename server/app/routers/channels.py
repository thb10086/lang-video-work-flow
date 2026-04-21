"""Channel CRUD + health check endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.ai_channel import (
    AiChannelCreate,
    AiChannelUpdate,
    AiChannelResponse,
    AiChannelListResponse,
)
from app.schemas.common import SuccessResponse
from app.services.channel_service import ChannelService

router = APIRouter(prefix="/api/channels", tags=["channels"])


def _get_service(db: AsyncSession = Depends(get_db)) -> ChannelService:
    return ChannelService(db)


@router.get("", response_model=SuccessResponse[AiChannelListResponse])
async def list_channels(svc: ChannelService = Depends(_get_service)):
    """获取所有渠道列表（不含 api_key 明文）"""
    channels = await svc.list_channels()
    items = [AiChannelResponse.model_validate(ch) for ch in channels]
    return SuccessResponse(data=AiChannelListResponse(items=items, total=len(items)))


@router.get("/{channel_id}", response_model=SuccessResponse[AiChannelResponse])
async def get_channel(channel_id: str, svc: ChannelService = Depends(_get_service)):
    channel = await svc.get_channel(channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail=f"Channel not found: {channel_id}")
    return SuccessResponse(data=AiChannelResponse.model_validate(channel))


@router.post("/{channel_id}/health")
async def check_health(channel_id: str, svc: ChannelService = Depends(_get_service)):
    """执行渠道健康检查"""
    healthy = await svc.health_check(channel_id)
    return SuccessResponse(data={"channel_id": channel_id, "healthy": healthy})


@router.post("", response_model=SuccessResponse[AiChannelResponse])
async def create_channel(body: AiChannelCreate, svc: ChannelService = Depends(_get_service)):
    channel = await svc.create_channel(body.model_dump())
    return SuccessResponse(data=AiChannelResponse.model_validate(channel))


@router.put("/{db_id}", response_model=SuccessResponse[AiChannelResponse])
async def update_channel(
    db_id: int,
    body: AiChannelUpdate,
    svc: ChannelService = Depends(_get_service),
):
    channel = await svc.update_channel(db_id, body.model_dump(exclude_none=True))
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    return SuccessResponse(data=AiChannelResponse.model_validate(channel))


@router.delete("/{db_id}")
async def delete_channel(db_id: int, svc: ChannelService = Depends(_get_service)):
    ok = await svc.delete_channel(db_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Channel not found")
    return SuccessResponse(message="deleted")
