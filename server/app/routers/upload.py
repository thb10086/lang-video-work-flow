"""COS upload proxy endpoints."""

from fastapi import APIRouter, HTTPException

from app.schemas.common import SuccessResponse
from app.schemas.generate import (
    ImageUploadRequest,
    ImageUploadResponse,
    BatchUploadRequest,
    BatchUploadResponse,
)
from app.services.cos_service import cos_service

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.post("/image", response_model=SuccessResponse[ImageUploadResponse])
async def upload_image(body: ImageUploadRequest):
    """上传单张图片到 COS"""
    if not cos_service.ready:
        raise HTTPException(status_code=503, detail="COS not configured")
    try:
        result = await cos_service.upload(body.data, body.filename)
        return SuccessResponse(data=ImageUploadResponse(**result))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch", response_model=SuccessResponse[BatchUploadResponse])
async def upload_batch(body: BatchUploadRequest):
    """批量上传图片到 COS"""
    if not cos_service.ready:
        raise HTTPException(status_code=503, detail="COS not configured")
    try:
        items = [{"data": img.data, "filename": img.filename} for img in body.images]
        results = await cos_service.upload_batch(items)
        return SuccessResponse(
            data=BatchUploadResponse(
                results=[ImageUploadResponse(**r) for r in results]
            )
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
