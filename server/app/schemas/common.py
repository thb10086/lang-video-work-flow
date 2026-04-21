"""Common response schemas."""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class SuccessResponse(BaseModel, Generic[T]):
    code: int = 0
    data: T | None = None
    message: str = "ok"
