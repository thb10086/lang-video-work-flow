"""Workflow CRUD endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.workflow import Workflow
from app.models.project import Project
from app.schemas.workflow import WorkflowCreate, WorkflowUpdate, WorkflowResponse, WorkflowListResponse
from app.schemas.common import SuccessResponse

router = APIRouter(prefix="/api", tags=["workflows"])


@router.post("/projects/{project_id}/workflows", response_model=SuccessResponse[WorkflowResponse])
async def save_workflow(project_id: int, body: WorkflowCreate, db: AsyncSession = Depends(get_db)):
    # Verify project exists
    proj = await db.execute(select(Project).where(Project.id == project_id, Project.deleted_at.is_(None)))
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    # Mark all previous versions as non-current
    await db.execute(
        update(Workflow)
        .where(Workflow.project_id == project_id, Workflow.is_current == 1)
        .values(is_current=0)
    )

    # Get next version number
    result = await db.execute(
        select(Workflow.version)
        .where(Workflow.project_id == project_id)
        .order_by(Workflow.version.desc())
        .limit(1)
    )
    last_version = result.scalar_one_or_none() or 0

    workflow = Workflow(
        project_id=project_id,
        name=body.name,
        version=last_version + 1,
        is_current=1,
        nodes_json=body.nodes_json,
        edges_json=body.edges_json,
        metadata_json=body.metadata_json,
        thumbnail_url=body.thumbnail_url,
    )
    db.add(workflow)
    await db.commit()
    await db.refresh(workflow)
    return SuccessResponse(data=WorkflowResponse.model_validate(workflow))


@router.get("/projects/{project_id}/workflows", response_model=SuccessResponse[WorkflowListResponse])
async def list_workflows(project_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Workflow)
        .where(Workflow.project_id == project_id, Workflow.deleted_at.is_(None))
        .order_by(Workflow.version.desc())
    )
    workflows = result.scalars().all()
    return SuccessResponse(data=WorkflowListResponse(
        items=[WorkflowResponse.model_validate(w) for w in workflows],
        total=len(workflows),
    ))


@router.get("/projects/{project_id}/workflows/current", response_model=SuccessResponse[WorkflowResponse])
async def get_current_workflow(project_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Workflow).where(
            Workflow.project_id == project_id,
            Workflow.is_current == 1,
            Workflow.deleted_at.is_(None),
        )
    )
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="No current workflow found")
    return SuccessResponse(data=WorkflowResponse.model_validate(workflow))


@router.put("/workflows/{workflow_id}", response_model=SuccessResponse[WorkflowResponse])
async def update_workflow(workflow_id: int, body: WorkflowUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.deleted_at.is_(None))
    )
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    update_data = body.model_dump(exclude_none=True)
    if update_data:
        await db.execute(update(Workflow).where(Workflow.id == workflow_id).values(**update_data))
        await db.commit()
        await db.refresh(workflow)

    return SuccessResponse(data=WorkflowResponse.model_validate(workflow))
