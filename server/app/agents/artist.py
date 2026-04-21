"""
Artist Agent — 美术指导专家

职责：
  - 增强角色外貌描述（六维优化法）
  - 锁定视觉风格（色调、光照、材质、情绪）
  - 确保角色一致性锚定词贯穿全片
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.agents.state import CharacterSpec, VideoProjectState
from app.config import settings

logger = logging.getLogger("prism.artist")

ARTIST_SYSTEM = """You are a visual art director for AI video production.

## Six-Dimension Optimization (for image prompts)
1. **Subject**: Main subject with precise attributes (age, build, clothing, expression)
2. **Environment**: Background with spatial depth (foreground, midground, background layers)
3. **Composition**: Camera angle, framing, rule of thirds, leading lines
4. **Lighting**: Direction, intensity, color temperature, shadow quality
5. **Style**: Art style keywords (cinematic, anime, photorealistic, watercolor, etc.)
6. **Technical**: Resolution cues, lens type, depth of field, film grain

## Character Consistency Protocol
- Each character needs a FIXED appearance anchor: [hair color+style] + [signature outfit] + [body type/age] + [unique identifier]
- This anchor must be identical across all prompts where the character appears
- Never change anchor words between shots

## Color Theory
- Warm palette (amber/gold/coral): comfort, nostalgia, romance
- Cool palette (blue/teal/silver): mystery, technology, isolation
- High contrast: drama, power
- Desaturated: melancholy, vintage, documentary feel

Always respond in valid JSON, no markdown wrapping."""


def _get_llm(temperature: float = 0.6) -> ChatOpenAI:
    return ChatOpenAI(
        model="gemini-3.1-pro-preview",
        base_url=f"{settings.LLM_BASE_URL}/v1",
        api_key=settings.LLM_API_KEY,
        temperature=temperature,
        max_tokens=2000,
    )


async def run_design_characters(state: VideoProjectState) -> dict[str, Any]:
    """美术设计：增强角色外貌描述。"""
    llm = _get_llm()
    characters = state.get("characters", [])
    style = state.get("style_description", "")

    if not characters:
        return {
            "phase": "design",
            "messages": [AIMessage(content="[美术] 无角色需要设计")],
        }

    char_list = "\n".join(
        f"- {c.get('name', '?')}: {c.get('appearance', 'no description')}"
        for c in characters
    )

    prompt = f"""Enhance each character's appearance for AI image generation consistency.

Style context: {style or 'cinematic realistic'}
Current characters:
{char_list}

For each character, create a FIXED appearance anchor (60-80 words English) following this template:
[hair color+style], [signature outfit with specific colors/patterns], [body type/age], [distinctive features like scars/accessories/tattoos], [skin tone], [expression tendency]

Return JSON array (no markdown):
[{{"name": "...", "appearance": "enhanced English anchor description", "role": "protagonist|supporting|extra"}}]"""

    resp = await llm.ainvoke([
        SystemMessage(content=ARTIST_SYSTEM),
        HumanMessage(content=prompt),
    ])

    try:
        raw = str(resp.content).replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)
        enhanced = [
            CharacterSpec(
                name=c.get("name", ""),
                appearance=c.get("appearance", ""),
                role=c.get("role", "supporting"),
            )
            for c in data
        ]
    except (json.JSONDecodeError, AttributeError):
        logger.warning("Artist character enhancement parse failed, keeping original")
        enhanced = characters

    logger.info(f"Characters designed: {len(enhanced)}")
    return {
        "characters": enhanced,
        "phase": "design",
        "messages": [AIMessage(content=f"[美术] {len(enhanced)} 个角色外貌锚定完成")],
    }


async def run_design_style(state: VideoProjectState) -> dict[str, Any]:
    """风格锁定：确定全片视觉风格。"""
    llm = _get_llm(temperature=0.5)
    scenario = state.get("scenario", {})
    user_input = state.get("user_input", "")
    synopsis = state.get("synopsis", "")

    prompt = f"""Define the visual style for this video project.

Scenario: {scenario.get('label', 'short film')}
User request: {user_input}
Synopsis: {synopsis[:200] if synopsis else 'not yet written'}

Create a concise style description (60 words max, English) covering:
- Color palette (warm/cool/specific colors)
- Lighting (natural/studio/mixed, direction, quality)
- Texture/material feel
- Mood/atmosphere
- Art style reference (cinematic/anime/documentary/etc.)

Return JSON (no markdown):
{{"style_description": "...", "color_palette": "warm|cool|neutral|high_contrast", "art_style": "cinematic|anime|photorealistic|stylized"}}"""

    resp = await llm.ainvoke([
        SystemMessage(content=ARTIST_SYSTEM),
        HumanMessage(content=prompt),
    ])

    try:
        raw = str(resp.content).replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)
        style_desc = data.get("style_description", "cinematic, warm lighting, soft shadows")
    except (json.JSONDecodeError, AttributeError):
        style_desc = "cinematic, warm natural lighting, rich colors, soft shadows, shallow depth of field"

    logger.info(f"Style defined: {style_desc[:60]}...")
    return {
        "style_description": style_desc,
        "phase": "design",
        "messages": [AIMessage(content=f"[美术] 风格锁定: {style_desc[:80]}")],
    }
