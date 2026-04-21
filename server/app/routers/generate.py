"""Generation proxy endpoints: image, video, llm chat."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db, get_redis
from app.schemas.common import SuccessResponse
from app.schemas.generate import (
    ImageGenerateRequest,
    ImageGenerateResponse,
    GeneratedImage,
    VideoGenerateRequest,
    VideoTaskResponse,
    LLMChatRequest,
    LLMChatResponse,
)
from app.services.image_service import ImageService
from app.services.video_service import VideoService
from app.services.llm_service import LLMService

router = APIRouter(prefix="/api/generate", tags=["generate"])


# ── Image Generation ──

@router.post("/image", response_model=SuccessResponse[ImageGenerateResponse])
async def generate_image(
    body: ImageGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    """生成图片（同步返回 base64 + 可选 COS URL）"""
    svc = ImageService(db)
    try:
        result = await svc.generate(
            model_id=body.model_id,
            prompt=body.prompt,
            reference_images=body.reference_images,
            params=body.params,
        )
        images = [
            GeneratedImage(
                data=img.get("data", ""),
                mime_type=img.get("mimeType", "image/png"),
                url=img.get("url"),
            )
            for img in result.get("images", [])
        ]
        return SuccessResponse(
            data=ImageGenerateResponse(
                images=images,
                text=result.get("text"),
                usage=result.get("usage"),
            )
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Video Generation (async task) ──

@router.post("/video", response_model=SuccessResponse[VideoTaskResponse])
async def submit_video(
    body: VideoGenerateRequest,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """提交视频生成任务（异步，返回 task_id）"""
    svc = VideoService(db, redis)
    try:
        result = await svc.submit(
            model_id=body.model_id,
            prompt=body.prompt,
            images=body.images,
            params=body.params,
        )
        return SuccessResponse(
            data=VideoTaskResponse(task_id=result["task_id"], status=result["status"])
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── LLM Chat ──

@router.post("/chat", response_model=SuccessResponse[LLMChatResponse])
async def llm_chat(
    body: LLMChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """LLM 非流式对话"""
    svc = LLMService(db)
    try:
        result = await svc.chat(
            model_id=body.model_id,
            prompt=body.prompt,
            system_prompt=body.system_prompt,
            temperature=body.temperature,
            max_tokens=body.max_tokens,
            params=body.params,
        )
        return SuccessResponse(
            data=LLMChatResponse(text=result["text"], usage=result.get("usage"))
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
