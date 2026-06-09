"""asset.* tools — admin/internal writes against the Asset Library tables.

Today only one tool is registered:

  - `asset.update_identity({asset_id, embedding})` — write an
    `IdentityEmbedding` payload to the asset's `metadata_json` so the
    `IdentityRouter` (server/app/services/identity_router.py) can pick
    it up at video-submit time.

**Why not a dedicated DB column?** Task 0.9.3 reserved the addition of
an `identity_embedding JSON NULL` column to the asset library tables
for Phase 3. Until that Alembic migration lands, we tunnel through the
existing `metadata_json` blob — the dataclass shape is identical, and
the router already reads either source via the same
`AssetReference.identity_embedding` field (today populated by the
test/integration layer, tomorrow populated by this tool's writes).

**Why server-scope (not exposed to the LLM)?** Identity embeddings
are produced by future visual ID services (IP-Adapter / FaceID / Sora
Character) — there's no scenario where the agent should be inventing
embedding vectors. Exposing this as a server-scope tool means it sits
in the registry (so internal services / admin scripts can dispatch it)
but is filtered out of the OpenAI tools[] array surfaced to the model.

Risk level: low. The handler validates the embedding shape strictly
and only patches a single key on `metadata_json` — no destructive ops.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.tool_registry import Tool, get_registry
from app.agents.types import ToolResult
from app.models.asset_library import CharacterAsset, SceneAsset, StyleAsset

logger = logging.getLogger("prism.agent.tools.asset")


# ============================================================
# Helpers
# ============================================================

# Single source of truth for asset_id prefix → ORM model mapping. We
# duplicate the (very small) table from `AssetService._infer_kind` so
# this module has no service-layer dependency — keeps the tool import
# graph minimal and decouples it from `AssetService`'s constructor
# signature (which takes a DB session).
_PREFIX_TO_MODEL: dict[str, Any] = {
    "char_": CharacterAsset,
    "scene_": SceneAsset,
    "style_": StyleAsset,
}


def _model_for_asset_id(asset_id: str) -> Any | None:
    """Return the ORM model whose prefix matches `asset_id`, or `None`."""
    for prefix, model in _PREFIX_TO_MODEL.items():
        if asset_id.startswith(prefix):
            return model
    return None


def _validate_embedding(raw: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Validate the embedding payload. Returns `(normalized, error_msg)`.

    Required: `vector_id: str (non-empty)`, `provider: str (non-empty)`.
    Optional: `metadata: dict` (defaults to `{}` when absent / non-dict).
    """
    if not isinstance(raw, dict):
        return None, "embedding 必须是对象"

    vector_id = raw.get("vector_id")
    if not isinstance(vector_id, str) or not vector_id.strip():
        return None, "embedding.vector_id 必须是非空字符串"

    provider = raw.get("provider")
    if not isinstance(provider, str) or not provider.strip():
        return None, "embedding.provider 必须是非空字符串"

    metadata = raw.get("metadata")
    if metadata is None or not isinstance(metadata, dict):
        metadata = {}

    return {
        "vector_id": vector_id.strip(),
        "provider": provider.strip(),
        "metadata": dict(metadata),  # shallow copy so callers can't mutate later
    }, None


# ============================================================
# Handlers
# ============================================================

async def _handle_update_identity(args: dict[str, Any], ctx: dict[str, Any]) -> ToolResult:
    """Persist an identity embedding to an asset's `metadata_json`.

    Side-effects: SQL UPDATE on the resolved asset library table, then
    `db.commit()`. Idempotent at the embedding level (the same vector_id
    can be written repeatedly without error).
    """
    db: AsyncSession = ctx["db"]

    asset_id_raw = args.get("asset_id")
    if not isinstance(asset_id_raw, str) or not asset_id_raw.strip():
        return ToolResult.failure("missing_args", "asset_id 必须是非空字符串")
    asset_id = asset_id_raw.strip()

    embedding_raw = args.get("embedding")
    if embedding_raw is None:
        return ToolResult.failure("missing_args", "embedding 不能为空")

    embedding, err = _validate_embedding(embedding_raw)
    if err is not None or embedding is None:
        return ToolResult.failure("invalid_args", err or "embedding 参数无效")

    Model = _model_for_asset_id(asset_id)
    if Model is None:
        return ToolResult.failure(
            "invalid_args",
            f"asset_id 前缀无法识别（期望 char_/scene_/style_）：{asset_id}",
        )

    # Locate the row. We deliberately ignore `user_id` (this is an
    # internal/admin write — the visual identity service is system-level)
    # but we still respect soft-delete: identity embeddings on a deleted
    # asset are conceptually meaningless.
    result = await db.execute(
        select(Model)
        .where(Model.asset_id == asset_id)
        .where(Model.deleted_at.is_(None))
    )
    row = result.scalar_one_or_none()
    if row is None:
        return ToolResult.failure("not_found", f"未找到 asset：{asset_id}")

    # Patch metadata_json non-destructively: preserve all existing keys,
    # only overwrite (or insert) `identity_embedding`. Re-assigning the
    # whole dict is required so SQLAlchemy's JSON change detection picks
    # up the mutation.
    existing = dict(row.metadata_json or {})
    existing["identity_embedding"] = embedding
    row.metadata_json = existing

    await db.commit()
    await db.refresh(row)

    logger.info(
        "asset.update_identity wrote provider=%s vector_id=%s on asset_id=%s",
        embedding["provider"],
        embedding["vector_id"][:48],  # truncate URL/long IDs in logs
        asset_id,
    )

    return ToolResult(
        ok=True,
        data={
            "asset_id": asset_id,
            "embedding": embedding,
        },
        hints=["identity_embedding 已写入 metadata_json"],
    )


# ============================================================
# Registration
# ============================================================

def register() -> None:
    r = get_registry()
    r.register(Tool(
        name="asset.update_identity",
        description=(
            "[internal/admin] 把视觉 identity embedding（IP-Adapter / FaceID / Sora Character"
            " 等服务产出的 vector_id）写入到指定 asset 的 metadata_json。供未来视觉服务触发，"
            "Agent 不应主动调用。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "asset_id": {
                    "type": "string",
                    "description": "Asset Library ID，前缀决定类型：char_/scene_/style_。",
                },
                "embedding": {
                    "type": "object",
                    "properties": {
                        "vector_id": {
                            "type": "string",
                            "description": "向量/资源的稳定 ID 或 URL（不同 provider 含义不同）。",
                        },
                        "provider": {
                            "type": "string",
                            "description": "产出该 embedding 的服务标识，如 sora_character / ip_adapter / face_id。",
                        },
                        "metadata": {
                            "type": "object",
                            "description": "provider 自带的额外元数据（如 timestamps、similarity_score）。",
                        },
                    },
                    "required": ["vector_id", "provider"],
                },
            },
            "required": ["asset_id", "embedding"],
        },
        handler=_handle_update_identity,
        tier="tier3",
        risk_level="low",
        scope="server",
    ))
