"""Async task status query endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db, get_redis
from app.schemas.common import SuccessResponse
from app.schemas.generate import TaskStatusResponse
from app.services.video_service import VideoService

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/{task_id}", response_model=SuccessResponse[TaskStatusResponse])
async def get_task_status(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """查询异步任务状态（前端轮询）"""
    svc = VideoService(db, redis)
    try:
        result = await svc.query_task(task_id)
        return SuccessResponse(
            data=TaskStatusResponse(
                task_id=result["task_id"],
                status=result["status"],
                progress=result.get("progress"),
                output_url=result.get("output_url"),
                output_urls=result.get("output_urls"),
                error=result.get("error"),
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
