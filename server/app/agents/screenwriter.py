"""
Screenwriter Agent — 编剧专家

职责：
  - 根据用户需求和场景类型生成剧本大纲
  - 输出结构化角色列表（含外貌锚定词）
  - 遵循 AI 友好写作原则：具象 > 抽象，Show Don't Tell
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.agents.state import CharacterSpec, VideoProjectState
from app.config import settings

logger = logging.getLogger("prism.screenwriter")

SCREENWRITER_SYSTEM = """You are a professional screenwriter for AI video production.

## Core Principles
- **Show, Don't Tell**: Every sentence must be visually concrete — describable as a single frame.
- **AI-Friendly Writing**: Use specific visual actions instead of abstract emotions.
  BAD: "She is sad"  GOOD: "She stares at a cracked photo in her trembling hands, a single tear rolls down her cheek"
- **Character Anchoring**: Every time a character appears, repeat key appearance words (hair + outfit + build + distinctive mark).
- **Environment 5-Elements**: Each scene must specify: space type, lighting, color tone, key props, atmosphere.

## Output Rules
- Title: concise, evocative
- Synopsis: 80-120 words, structured as setup → conflict → resolution
- Characters: 2-5 characters, each with name + English appearance (50 words) + role
- Always respond in valid JSON, no markdown wrapping."""


def _get_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.DEFAULT_LLM_MODEL,
        base_url=f"{settings.LLM_BASE_URL}/v1",
        api_key=settings.LLM_API_KEY,
        temperature=0.8,
        max_tokens=2000,
    )


async def run_screenwriter(state: VideoProjectState) -> dict[str, Any]:
    """编剧节点：生成大纲 + 角色列表。"""
    llm = _get_llm()
    scenario = state.get("scenario", {})
    user_input = state.get("user_input", "")

    prompt = f"""Create a short video script outline.

Scene type: {scenario.get('label', '短剧')}
User request: {user_input}

Return JSON (no markdown):
{{
  "title": "作品标题 (Chinese)",
  "synopsis": "80-120 word synopsis in Chinese, structured as setup→conflict→resolution",
  "characters": [
    {{
      "name": "角色名 (Chinese)",
      "appearance": "Detailed English appearance description, 50 words. Include: hair color+style, outfit, build/age, distinctive features. This will be used as AI image generation prompt anchor.",
      "role": "protagonist|supporting|extra"
    }}
  ]
}}"""

    resp = await llm.ainvoke([
        SystemMessage(content=SCREENWRITER_SYSTEM),
        HumanMessage(content=prompt),
    ])

    try:
        raw = str(resp.content).replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)
    except (json.JSONDecodeError, AttributeError) as e:
        logger.error(f"Screenwriter JSON parse error: {e}")
        return {
            "phase": "error",
            "error_message": f"编剧返回格式错误: {str(resp.content)[:200]}",
            "messages": [AIMessage(content="[编剧] 大纲生成失败，格式解析错误")],
        }

    characters = [
        CharacterSpec(
            name=c.get("name", ""),
            appearance=c.get("appearance", ""),
            role=c.get("role", "supporting"),
        )
        for c in data.get("characters", [])
    ]

    title = data.get("title", "")
    synopsis = data.get("synopsis", "")
    logger.info(f"Screenwriter done: '{title}' ({len(characters)} characters)")

    return {
        "title": title,
        "synopsis": synopsis,
        "characters": characters,
        "phase": "planning",
        "messages": [AIMessage(content=f"[编剧] 大纲完成: {title} ({len(characters)} 角色)")],
    }
