"""Shared agent runtime types.

Single source of truth for the structured ToolResult contract (D-6) and
RiskLevel/Tier enums (D-5/D-7).
"""
from __future__ import annotations

from typing import Any, Generic, Literal, Optional, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


# ============================================================
# Structured ToolResult (D-6)
# ============================================================


class ToolError(BaseModel):
    code: str
    message: str
    recoverable: bool = False


class ToolMeta(BaseModel):
    elapsed_ms: int = 0
    cost_tokens: Optional[int] = None


class ToolResult(BaseModel, Generic[T]):
    """Canonical envelope returned by every server-side tool handler.

    Matches the TypeScript interface in `src/providers/types.ts`.
    """
    ok: bool
    data: Optional[Any] = None
    hints: list[str] = Field(default_factory=list)
    next_step: Optional[str] = None
    error: Optional[ToolError] = None
    meta: Optional[ToolMeta] = None

    def to_legacy(self) -> dict[str, Any]:
        """Adapt the new envelope to the legacy `{success, message, nodeIds?}`
        shape so existing OpenAI tool_result message bodies stay compatible.
        """
        message_parts: list[str] = []
        if self.hints:
            message_parts.extend(self.hints)
        if self.data is not None:
            try:
                import json as _json
                message_parts.append(
                    _json.dumps(self.data, ensure_ascii=False, default=str)
                )
            except Exception:
                message_parts.append(str(self.data))
        elif self.error is not None:
            message_parts.append(f"[{self.error.code}] {self.error.message}")
        message = " | ".join(message_parts)[:200]

        node_ids: list[str] = []
        if isinstance(self.data, dict):
            ids = self.data.get("affected_node_ids") or self.data.get("nodeIds")
            if isinstance(ids, list):
                node_ids = [str(x) for x in ids]
        return {
            "success": self.ok,
            "message": message,
            "nodeIds": node_ids or None,
        }

    @classmethod
    def success(
        cls,
        data: Optional[Any] = None,
        *,
        hints: Optional[list[str]] = None,
        next_step: Optional[str] = None,
        elapsed_ms: int = 0,
    ) -> "ToolResult[Any]":
        return cls(
            ok=True,
            data=data,
            hints=hints or [],
            next_step=next_step,
            meta=ToolMeta(elapsed_ms=elapsed_ms),
        )

    @classmethod
    def failure(
        cls,
        code: str,
        message: str,
        *,
        recoverable: bool = False,
        hints: Optional[list[str]] = None,
        elapsed_ms: int = 0,
    ) -> "ToolResult[Any]":
        return cls(
            ok=False,
            error=ToolError(code=code, message=message, recoverable=recoverable),
            hints=hints or [],
            meta=ToolMeta(elapsed_ms=elapsed_ms),
        )


# ============================================================
# Risk levels & tier ids — used by the registry
# ============================================================

RiskLevel = Literal["safe", "low", "medium", "high", "critical"]
TierId = Literal["tier1", "tier2", "tier3"]
ToolScope = Literal["server", "client"]
