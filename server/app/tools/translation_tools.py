"""
Translation Tools — 中英翻译 / 提示词优化

提供中英双向翻译和提示词语言规范化。
视频/图片提示词使用英文，UI 文案使用中文。
"""

from __future__ import annotations

import logging

from app.tools.generation_tools import llm_chat

logger = logging.getLogger("prism.tools.translation")


async def translate_to_english(text: str) -> str:
    """将中文文本翻译为英文（适用于 AI 图片/视频提示词）。"""
    if not text or not any('\u4e00' <= c <= '\u9fff' for c in text):
        return text  # Already English or empty

    result = await llm_chat(
        prompt=f"Translate the following Chinese text to English. Keep it concise and suitable for AI image/video generation prompts. Output ONLY the English translation, no explanation.\n\n{text}",
        system="You are a precise translator specializing in AI visual generation prompts.",
        temperature=0.3,
        max_tokens=500,
    )
    return result.strip()


async def translate_to_chinese(text: str) -> str:
    """将英文文本翻译为中文（适用于 UI 展示）。"""
    if not text or not any('a' <= c.lower() <= 'z' for c in text):
        return text  # Already Chinese or empty

    result = await llm_chat(
        prompt=f"将以下英文翻译为简洁的中文。仅输出翻译结果，不要解释。\n\n{text}",
        system="你是专业翻译，擅长视频制作领域术语。",
        temperature=0.3,
        max_tokens=500,
    )
    return result.strip()


async def ensure_english_prompt(prompt: str) -> str:
    """确保提示词为英文。如果包含中文则翻译。"""
    has_chinese = any('\u4e00' <= c <= '\u9fff' for c in prompt)
    if not has_chinese:
        return prompt
    return await translate_to_english(prompt)


async def batch_translate_prompts(prompts: list[str]) -> list[str]:
    """批量翻译提示词为英文。"""
    results: list[str] = []
    for p in prompts:
        results.append(await ensure_english_prompt(p))
    return results
