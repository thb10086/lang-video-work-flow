"""memory.* tools — persistent agent memory backed by `agent_memories` table.

Three tools today:
  - memory.save({type, title, content, tags?, scope?, pinned?, project_id?})
  - memory.recall({query, limit?, project_id?})
  - memory.forget({id?, tag?, scope?, older_than_days?})

Ranking matches the legacy frontend `agentMemoryStore.recallMemories`:
  score = 3 * title_match + 2 * content_match + 2 * tag_match
        + recency_bonus(30 days) + 0.5 * is_task_summary + 0.3 * is_workflow_pattern
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.tool_registry import Tool, get_registry
from app.agents.types import ToolResult
from app.models.agent import AgentMemory


# ============================================================
# Handlers
# ============================================================

async def _handle_save(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    db: AsyncSession = ctx["db"]
    memory_type = str(args.get("type") or "user_feedback")
    title = str(args.get("title") or "").strip()
    content = str(args.get("content") or "").strip()
    if not title or not content:
        return ToolResult.failure("missing_args", "title 和 content 都不能为空")

    tags = args.get("tags")
    if not isinstance(tags, list):
        tags = []
    scope = str(args.get("scope") or "session")
    if scope not in ("session", "project", "global"):
        scope = "session"
    pinned = bool(args.get("pinned"))
    project_id = args.get("project_id")
    if scope != "project":
        project_id = None

    # Dedupe by (type, title) — update existing instead of creating duplicates.
    existing = await db.execute(
        select(AgentMemory).where(AgentMemory.type == memory_type).where(AgentMemory.title == title)
    )
    row = existing.scalar_one_or_none()
    now = datetime.utcnow()
    if row is not None:
        row.content = content
        row.tags_json = tags
        row.scope = scope
        row.pinned = pinned
        row.project_id = project_id
        row.last_accessed_at = now
        await db.commit()
        return ToolResult(ok=True, data={"id": row.id, "deduped": True})

    new_row = AgentMemory(
        user_id=1,
        project_id=project_id,
        scope=scope,
        type=memory_type,
        title=title,
        content=content,
        tags_json=tags,
        pinned=pinned,
        last_accessed_at=now,
    )
    db.add(new_row)
    await db.commit()
    await db.refresh(new_row)
    return ToolResult(
        ok=True,
        data={"id": new_row.id, "deduped": False},
        next_step="memory.recall",
    )


async def _handle_recall(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    db: AsyncSession = ctx["db"]
    query = str(args.get("query") or "").strip()
    limit = int(args.get("limit") or 5)
    project_id = args.get("project_id")

    stmt = select(AgentMemory).where(AgentMemory.deleted_at.is_(None))
    # scope filter: project memories only when on matching project
    if project_id is not None:
        # Show: global + project-matched (drop other-project rows)
        stmt = stmt.where(
            (AgentMemory.scope != "project") | (AgentMemory.project_id == project_id)
        )
    rows_result = await db.execute(stmt.limit(200))
    rows: list[AgentMemory] = list(rows_result.scalars())

    terms = [t.lower() for t in query.split() if t]
    now = datetime.utcnow()
    scored: list[tuple[AgentMemory, float]] = []
    for m in rows:
        score = 0.0
        title_lc = (m.title or "").lower()
        content_lc = (m.content or "").lower()
        tags_lc = [str(t).lower() for t in (m.tags_json or [])]
        for t in terms:
            if t in title_lc:
                score += 3.0
            if t in content_lc:
                score += 2.0
            if any(t in tag for tag in tags_lc):
                score += 2.0
        # Recency (30 day half-life, max bonus 1.0)
        delta_days = max(0.0, (now - (m.last_accessed_at or m.updated_at)).total_seconds() / 86400)
        score += max(0.0, 1.0 - delta_days / 30.0)
        if m.type == "task_summary":
            score += 0.5
        if m.type == "workflow_pattern":
            score += 0.3
        if m.pinned:
            score += 100.0  # pinned always wins
        if score > 0:
            scored.append((m, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    picked = scored[:limit]

    # Update last_accessed_at for ranked entries (no commit per row — batched).
    for m, _ in picked:
        m.last_accessed_at = now
    await db.commit()

    items = [
        {
            "id": m.id,
            "type": m.type,
            "title": m.title,
            "content": (m.content or "")[:200],
            "tags": list(m.tags_json or []),
            "scope": m.scope,
            "pinned": m.pinned,
        }
        for m, _ in picked
    ]
    return ToolResult(ok=True, data={"items": items, "total_visible": len(rows)})


async def _handle_forget(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    db: AsyncSession = ctx["db"]
    mem_id = args.get("id")
    tag = args.get("tag")
    scope = args.get("scope")
    older_days = args.get("older_than_days")

    if not any(x is not None for x in (mem_id, tag, scope, older_days)):
        return ToolResult.failure(
            "missing_args",
            "必须至少指定 id / tag / scope / older_than_days 中的一个",
        )

    stmt = select(AgentMemory).where(AgentMemory.deleted_at.is_(None))
    if mem_id is not None:
        stmt = stmt.where(AgentMemory.id == int(mem_id))
    if tag:
        # MySQL JSON array search — fall back to client-side filter for SQLite compat.
        pass
    if scope:
        stmt = stmt.where(AgentMemory.scope == str(scope))
    if older_days is not None:
        cutoff = datetime.utcnow() - timedelta(days=float(older_days))
        stmt = stmt.where(AgentMemory.updated_at < cutoff)

    rows = list((await db.execute(stmt)).scalars())
    matched: list[AgentMemory] = []
    for m in rows:
        if tag:
            tags_lc = [str(t).lower() for t in (m.tags_json or [])]
            if str(tag).lower() not in tags_lc:
                continue
        matched.append(m)

    now = datetime.utcnow()
    for m in matched:
        m.deleted_at = now
    await db.commit()
    return ToolResult(ok=True, data={"deleted_count": len(matched)})


# ============================================================
# Registration
# ============================================================

def register() -> None:
    r = get_registry()

    r.register(Tool(
        name="memory.save",
        description="保存一条长期记忆（项目偏好/角色设定/工作流模式/任务总结）。scope 可选 session/project/global，默认 session。",
        parameters={
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["project_preference", "character_profile", "style_guide",
                             "workflow_pattern", "user_feedback", "task_summary"],
                },
                "title": {"type": "string"},
                "content": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "scope": {"type": "string", "enum": ["session", "project", "global"]},
                "pinned": {"type": "boolean"},
                "project_id": {"type": "integer"},
            },
            "required": ["title", "content"],
        },
        handler=_handle_save,
        tier="tier3",
        risk_level="low",
        scope="server",
        aliases=("save_memory",),
    ))

    r.register(Tool(
        name="memory.recall",
        description="按查询字符串检索相关记忆，按相关度+时间衰减+pinned 加权排序，返回 top-K。",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "default": 5},
                "project_id": {"type": "integer"},
            },
            "required": ["query"],
        },
        handler=_handle_recall,
        tier="tier3",
        risk_level="safe",
        scope="server",
        aliases=("recall_memory",),
    ))

    r.register(Tool(
        name="memory.forget",
        description="软删除符合条件的记忆。必须至少指定 id / tag / scope / older_than_days 之一。",
        parameters={
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "tag": {"type": "string"},
                "scope": {"type": "string"},
                "older_than_days": {"type": "number"},
            },
        },
        handler=_handle_forget,
        tier="tier3",
        risk_level="medium",
        scope="server",
        aliases=("forget_memory",),
    ))
