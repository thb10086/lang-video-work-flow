"""Template CRUD endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.template import Template
from app.schemas.template import TemplateCreate, TemplateResponse, TemplateListResponse
from app.schemas.common import SuccessResponse

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("", response_model=SuccessResponse[TemplateListResponse])
async def list_templates(
    category: str | None = None,
    scenario: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Template).where(Template.deleted_at.is_(None))
    if category:
        query = query.where(Template.category == category)
    if scenario:
        query = query.where(Template.scenario == scenario)
    query = query.order_by(Template.use_count.desc())

    result = await db.execute(query)
    templates = result.scalars().all()
    return SuccessResponse(data=TemplateListResponse(
        items=[TemplateResponse.model_validate(t) for t in templates],
        total=len(templates),
    ))


@router.get("/{template_id}", response_model=SuccessResponse[TemplateResponse])
async def get_template(template_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Template).where(Template.id == template_id, Template.deleted_at.is_(None))
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return SuccessResponse(data=TemplateResponse.model_validate(template))


@router.post("", response_model=SuccessResponse[TemplateResponse])
async def create_template(body: TemplateCreate, db: AsyncSession = Depends(get_db)):
    template = Template(**body.model_dump(exclude_none=True))
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return SuccessResponse(data=TemplateResponse.model_validate(template))
