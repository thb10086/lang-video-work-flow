"""
BaseAdapter — 所有渠道适配器的抽象基类（策略模式）

子类需实现:
  - generate()      同步生成（LLM 文本 / 图片）
  - submit_task()   提交异步任务（视频等），返回 task_id
  - query_task()    查询异步任务状态
  - health_check()  渠道健康检查
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("prism.adapters")


@dataclass
class AdapterConfig:
    """渠道适配器配置（从 DB ai_channels 行构造）"""
    base_url: str
    api_key: str
    timeout: int = 120
    max_retries: int = 2
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class GenerateResult:
    """同步生成结果（LLM / 图片）"""
    success: bool
    data: Any = None
    error: str | None = None
    usage: dict[str, int] | None = None


@dataclass
class TaskSubmitResult:
    """异步任务提交结果"""
    success: bool
    task_id: str | None = None
    error: str | None = None


@dataclass
class TaskQueryResult:
    """异步任务查询结果"""
    task_id: str
    status: str  # pending | processing | completed | failed
    progress: float | None = None
    output_url: str | None = None
    output_urls: list[str] | None = None
    error: str | None = None
    raw: dict[str, Any] | None = None


class BaseAdapter(ABC):
    """所有渠道适配器的抽象基类"""

    def __init__(self, config: AdapterConfig) -> None:
        self.config = config
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        """延迟创建 httpx 异步客户端"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.config.base_url,
                timeout=httpx.Timeout(self.config.timeout, connect=10.0),
                headers=self._default_headers(),
            )
        return self._client

    def _default_headers(self) -> dict[str, str]:
        """默认请求头（子类可覆盖）"""
        return {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }

    @abstractmethod
    async def generate(self, model_id: str, params: dict[str, Any]) -> GenerateResult:
        """同步生成（LLM 文本 / 图片），阻塞直到返回结果"""
        ...

    async def submit_task(self, model_id: str, params: dict[str, Any]) -> TaskSubmitResult:
        """提交异步任务，返回 task_id（视频等）"""
        raise NotImplementedError(f"{self.__class__.__name__} does not support async tasks")

    async def query_task(self, task_id: str) -> TaskQueryResult:
        """查询异步任务状态"""
        raise NotImplementedError(f"{self.__class__.__name__} does not support task querying")

    async def health_check(self) -> bool:
        """渠道健康检查（子类可覆盖）"""
        try:
            resp = await self.client.get("/")
            return resp.status_code < 500
        except Exception:
            return False

    async def close(self) -> None:
        """释放 httpx 连接"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
