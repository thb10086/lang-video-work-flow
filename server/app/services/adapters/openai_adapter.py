"""
OpenAIAdapter — OpenAI 兼容 LLM Chat 适配器

API: POST /v1/chat/completions
支持：文本生成（流式/非流式）、Function Calling
兼容所有 OpenAI 格式模型（GPT、Gemini 等通过 yunwu.ai 代理）

移植自前端 OpenAIChatAdapter.ts + 后端 generation_tools.py
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from app.services.adapters.base import BaseAdapter, GenerateResult

logger = logging.getLogger("prism.adapters.openai")


class OpenAIAdapter(BaseAdapter):
    """OpenAI Chat Completions 适配器"""

    async def generate(self, model_id: str, params: dict[str, Any]) -> GenerateResult:
        """非流式 Chat Completion"""
        messages = params.get("messages") or []
        if not messages and params.get("prompt"):
            messages = []
            if params.get("system_prompt"):
                messages.append({"role": "system", "content": params["system_prompt"]})
            messages.append({"role": "user", "content": params["prompt"]})

        body: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "temperature": params.get("temperature", 0.7),
            "max_tokens": params.get("max_tokens", 2000),
        }

        # Function calling / tools
        if params.get("tools"):
            body["tools"] = params["tools"]
        if params.get("tool_choice"):
            body["tool_choice"] = params["tool_choice"]

        # Response format
        if params.get("response_format"):
            body["response_format"] = params["response_format"]

        try:
            resp = await self.client.post("/v1/chat/completions", json=body)
            if resp.status_code >= 400:
                return GenerateResult(success=False, error=f"LLM API error ({resp.status_code}): {resp.text[:300]}")

            data = resp.json()
            choice = data.get("choices", [{}])[0]
            message = choice.get("message", {})
            usage = data.get("usage")

            return GenerateResult(
                success=True,
                data={
                    "text": message.get("content", ""),
                    "tool_calls": message.get("tool_calls"),
                    "finish_reason": choice.get("finish_reason"),
                },
                usage={
                    "prompt_tokens": usage.get("prompt_tokens", 0),
                    "completion_tokens": usage.get("completion_tokens", 0),
                    "total_tokens": usage.get("total_tokens", 0),
                } if usage else None,
            )
        except Exception as e:
            return GenerateResult(success=False, error=str(e))

    async def generate_stream(self, model_id: str, params: dict[str, Any]) -> AsyncIterator[str]:
        """流式 Chat Completion (SSE)"""
        messages = params.get("messages") or []
        if not messages and params.get("prompt"):
            messages = []
            if params.get("system_prompt"):
                messages.append({"role": "system", "content": params["system_prompt"]})
            messages.append({"role": "user", "content": params["prompt"]})

        body: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "temperature": params.get("temperature", 0.7),
            "max_tokens": params.get("max_tokens", 2000),
            "stream": True,
        }

        async with self.client.stream("POST", "/v1/chat/completions", json=body) as resp:
            if resp.status_code >= 400:
                text = await resp.aread()
                raise Exception(f"LLM stream error ({resp.status_code}): {text.decode()[:300]}")

            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
                except json.JSONDecodeError:
                    continue

    async def generate_json(self, model_id: str, params: dict[str, Any]) -> GenerateResult:
        """生成 JSON 格式响应"""
        params = {**params, "response_format": {"type": "json_object"}}
        result = await self.generate(model_id, params)
        if result.success and result.data and result.data.get("text"):
            try:
                parsed = json.loads(result.data["text"])
                result.data["parsed"] = parsed
            except json.JSONDecodeError as e:
                logger.warning("Failed to parse JSON response: %s", e)
        return result

    async def health_check(self) -> bool:
        """通过 list models 检查连通性"""
        try:
            resp = await self.client.get("/v1/models")
            return resp.status_code < 400
        except Exception:
            return False
