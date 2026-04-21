"""
Review Gate — 自动质量审核 + 条件路由

三维审查：
  1. 角色一致性：检查角色外貌锚定词在分镜中的覆盖率
  2. 关键帧 Prompt Lint：检查提示词质量（长度、英文比例、结构）
  3. 视频输出检查：canvas_commands 完整性

审核结果驱动条件边路由：
  - passed → END
  - 角色问题 → retry_characters
  - 分镜问题 → retry_shots
  - 画布问题 → retry_canvas
  - 超过 max_retries → 强制 END
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import AIMessage

from app.agents.state import ReviewResult, VideoProjectState
from app.tools.review_tools import run_full_review

logger = logging.getLogger("prism.review_gate")


def _check_character_anchor_coverage(
    characters: list[dict[str, Any]],
    shots: list[dict[str, Any]],
) -> tuple[int, list[str]]:
    """检查角色外貌锚定词在分镜描述中的出现率。"""
    deduction = 0
    issues: list[str] = []

    if not characters or not shots:
        return 0, []

    for char in characters:
        name = char.get("name", "")
        appearance = char.get("appearance", "")
        if not appearance:
            continue

        # Extract key anchor words (first 3 significant words)
        anchor_words = [w.lower() for w in appearance.split()[:5] if len(w) > 3]
        if not anchor_words:
            continue

        # Check which shots mention this character
        char_shots = [s for s in shots if name in str(s.get("characters_present", []))]
        if not char_shots:
            continue

        # Check anchor word coverage in those shots
        for shot in char_shots:
            desc = shot.get("description", "").lower()
            covered = sum(1 for w in anchor_words if w in desc)
            coverage = covered / len(anchor_words) if anchor_words else 0

            if coverage < 0.3:
                issues.append(
                    f"分镜 #{shot.get('shot_number', '?')} 中角色「{name}」外貌锚定词覆盖率低 ({coverage:.0%})"
                )
                deduction += 3

    return deduction, issues


def _check_prompt_quality(shots: list[dict[str, Any]]) -> tuple[int, list[str]]:
    """关键帧 Prompt Lint：检查分镜描述质量。"""
    deduction = 0
    issues: list[str] = []

    for shot in shots:
        desc = shot.get("description", "")
        num = shot.get("shot_number", "?")

        # Length check
        word_count = len(desc.split())
        if word_count < 15:
            issues.append(f"分镜 #{num} 描述过短 ({word_count} 词，建议 ≥30)")
            deduction += 5
        elif word_count < 25:
            issues.append(f"分镜 #{num} 描述较短 ({word_count} 词，建议 ≥30)")
            deduction += 2

        # English ratio check (AI models work better with English prompts)
        if desc:
            ascii_chars = sum(1 for c in desc if ord(c) < 128)
            eng_ratio = ascii_chars / len(desc) if desc else 0
            if eng_ratio < 0.5:
                issues.append(f"分镜 #{num} 英文比例偏低 ({eng_ratio:.0%})，建议使用英文描述")
                deduction += 3

        # Camera move check
        camera = shot.get("camera_move", "")
        if not camera or camera == "":
            issues.append(f"分镜 #{num} 缺少运镜指定")
            deduction += 2

    return deduction, issues


async def run_review_gate(state: VideoProjectState) -> dict[str, Any]:
    """执行完整质量审核。"""
    characters = state.get("characters", [])
    shots = state.get("shots", [])
    style_desc = state.get("style_description", "")
    commands = state.get("canvas_commands", [])
    retry_count = state.get("retry_count", 0)

    # Base review from review_tools
    base_result = run_full_review(
        characters=characters,
        shots=shots,
        style_description=style_desc,
        canvas_commands=commands,
    )

    score = base_result["score"]
    all_issues: list[str] = list(base_result["issues"])
    suggestions: list[str] = list(base_result["suggestions"])

    # Additional: character anchor coverage
    d, issues = _check_character_anchor_coverage(characters, shots)
    score -= d
    all_issues.extend(issues)

    # Additional: prompt quality lint
    d, issues = _check_prompt_quality(shots)
    score -= d
    all_issues.extend(issues)

    score = max(score, 0)
    passed = score >= 70 and len(all_issues) <= 4

    # Auto-suggestions based on issues
    if any("锚定" in i or "覆盖" in i for i in all_issues):
        suggestions.append("重新设计角色时，确保外貌锚定词在所有相关分镜描述中出现")
    if any("英文" in i for i in all_issues):
        suggestions.append("建议将分镜描述翻译为英文，AI 模型对英文提示词效果更好")
    if any("运镜" in i for i in all_issues):
        suggestions.append("建议为每个分镜指定运镜类型（static/dolly/pan/tracking 等）")

    review = ReviewResult(
        passed=passed,
        score=score,
        issues=all_issues,
        suggestions=suggestions,
        reviewer="auto",
    )

    # Increment retry count if not passed
    new_retry = retry_count if passed else retry_count + 1

    logger.info(
        f"Review Gate: score={score}, passed={passed}, "
        f"issues={len(all_issues)}, retry={new_retry}"
    )

    return {
        "review": review,
        "retry_count": new_retry,
        "phase": "reviewing",
        "messages": [AIMessage(
            content=(
                f"[审核] 评分 {score}/100 "
                f"{'✅ 通过' if passed else '❌ 未通过'} "
                f"(问题 {len(all_issues)} 项, 重试 {new_retry}/{state.get('max_retries', 3)})"
            )
        )],
    }
