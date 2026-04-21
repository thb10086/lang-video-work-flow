"""Project CRUD endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse, ProjectListResponse
from app.schemas.common import SuccessResponse

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=SuccessResponse[ProjectResponse])
async def create_project(body: ProjectCreate, db: AsyncSession = Depends(get_db)):
    project = Project(**body.model_dump(exclude_none=True))
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return SuccessResponse(data=ProjectResponse.model_validate(project))


@router.get("", response_model=SuccessResponse[ProjectListResponse])
async def list_projects(
    status: str | None = None,
    scenario: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    query = select(Project).where(Project.deleted_at.is_(None))
    if status:
        query = query.where(Project.status == status)
    if scenario:
        query = query.where(Project.scenario == scenario)
    query = query.order_by(Project.updated_at.desc())

    # Count
    from sqlalchemy import func as sa_func
    count_q = select(sa_func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Paginate
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    projects = result.scalars().all()

    return SuccessResponse(data=ProjectListResponse(
        items=[ProjectResponse.model_validate(p) for p in projects],
        total=total,
        page=page,
        page_size=page_size,
    ))


@router.get("/{project_id}", response_model=SuccessResponse[ProjectResponse])
async def get_project(project_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return SuccessResponse(data=ProjectResponse.model_validate(project))


@router.put("/{project_id}", response_model=SuccessResponse[ProjectResponse])
async def update_project(project_id: int, body: ProjectUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_data = body.model_dump(exclude_none=True)
    if update_data:
        await db.execute(
            update(Project).where(Project.id == project_id).values(**update_data)
        )
        await db.commit()
        await db.refresh(project)

    return SuccessResponse(data=ProjectResponse.model_validate(project))


@router.delete("/{project_id}", response_model=SuccessResponse[None])
async def delete_project(project_id: int, db: AsyncSession = Depends(get_db)):
    from datetime import datetime
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.execute(
        update(Project).where(Project.id == project_id).values(deleted_at=datetime.now())
    )
    await db.commit()
    return SuccessResponse(data=None, message="Deleted")
