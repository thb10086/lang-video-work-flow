"""
Generation Tools — 图片/视频生成（后端直接调 API）

在后端模式下，部分生成任务可绕过前端直接在服务端完成。
当前支持：LLM 文本生成、图片分类。
图片/视频生成仍委托前端 nodeExecutor（通过 canvas_commands）。
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger("prism.tools.generation")


async def llm_chat(
    prompt: str,
    system: str = "",
    model: str = "gemini-3.1-pro-preview",
    temperature: float = 0.7,
    max_tokens: int = 2000,
) -> str:
    """调用 LLM Chat API，返回文本响应。"""
    messages: list[dict[str, Any]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{settings.LLM_BASE_URL}/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.LLM_API_KEY}",
            },
            json={
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def llm_chat_json(
    prompt: str,
    system: str = "Always respond in valid JSON, no markdown wrapping.",
    model: str = "gemini-3.1-pro-preview",
    temperature: float = 0.5,
) -> dict[str, Any]:
    """调用 LLM 并解析 JSON 响应。"""
    raw = await llm_chat(prompt, system=system, model=model, temperature=temperature)
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    return json.loads(cleaned)


async def classify_image_vision(
    image_url: str,
    model: str = "gpt-4o",
) -> dict[str, Any]:
    """使用 LLM vision 分类图片。返回 {category, description, confidence}。"""
    classify_prompt = """Analyze the given image and classify it into EXACTLY ONE category:
- product: A product photo, merchandise, packaging, food item
- character: A person, character design, portrait, reference sheet
- scene: A location, background, environment, landscape
- style_ref: An artwork, style reference, mood board
- logo: A brand logo, wordmark, icon
- other: None of the above

Respond in JSON: {"category":"<cat>","description":"<brief>","confidence":<0.0-1.0>}"""

    is_data_uri = image_url.startswith("data:")
    img_url = image_url if (is_data_uri or image_url.startswith("http")) else f"data:image/png;base64,{image_url}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{settings.LLM_BASE_URL}/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.LLM_API_KEY}",
            },
            json={
                "model": model,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": classify_prompt},
                        {"type": "image_url", "image_url": {"url": img_url}},
                    ],
                }],
                "max_tokens": 200,
                "temperature": 0.1,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        raw_content = data["choices"][0]["message"]["content"]
        cleaned = raw_content.replace("```json", "").replace("```", "").strip()
        return json.loads(cleaned)


async def optimize_prompt_llm(
    original_prompt: str,
    prompt_type: str = "image",
    style: str = "",
    character_anchors: list[str] | None = None,
) -> str:
    """使用 LLM 优化提示词。"""
    if prompt_type == "video":
        system = "You are a video prompt optimizer. Use the 5-section formula: [Subject + Action], [Camera Movement], [Lighting + Atmosphere], [Style + Quality], [Duration + Transition]."
    else:
        system = "You are an image prompt optimizer. Use the 6-dimension method: Subject, Environment, Composition, Lighting, Style, Technical."

    anchors_text = ""
    if character_anchors:
        anchors_text = f"\nCharacter anchors to preserve: {'; '.join(character_anchors)}"

    prompt = f"""Optimize this {prompt_type} generation prompt. Keep the original intent.
{f'Target style: {style}' if style else ''}
{anchors_text}

Original prompt: {original_prompt}

Return ONLY the optimized English prompt (no JSON, no explanation)."""

    return await llm_chat(prompt, system=system, temperature=0.6, max_tokens=500)
