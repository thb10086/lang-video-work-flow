"""
Review Tools — 质量审查工具

对 VideoProjectState 中的各阶段产出进行质量评估。
供 review_gate 节点和手动审核调用。
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("prism.tools.review")


def review_characters(characters: list[dict[str, Any]]) -> tuple[int, list[str]]:
    """审查角色列表质量。返回 (扣分, 问题列表)。"""
    deduction = 0
    issues: list[str] = []

    if not characters:
        return 20, ["无角色定义"]

    for c in characters:
        name = c.get("name", "")
        appearance = c.get("appearance", "")

        if not appearance:
            issues.append(f"角色「{name}」缺少外貌描述")
            deduction += 10
        elif len(appearance.split()) < 15:
            issues.append(f"角色「{name}」外貌描述过短 ({len(appearance.split())} 词，建议 ≥30)")
            deduction += 5

        if not name:
            issues.append("存在未命名角色")
            deduction += 5

    return deduction, issues


def review_shots(shots: list[dict[str, Any]]) -> tuple[int, list[str]]:
    """审查分镜列表质量。返回 (扣分, 问题列表)。"""
    deduction = 0
    issues: list[str] = []

    if not shots:
        return 25, ["无分镜定义"]

    if len(shots) < 3:
        issues.append(f"分镜数量不足 ({len(shots)}，建议 ≥4)")
        deduction += 10

    for s in shots:
        desc = s.get("description", "")
        if not desc:
            issues.append(f"分镜 #{s.get('shot_number', '?')} 缺少描述")
            deduction += 5
        elif len(desc.split()) < 10:
            issues.append(f"分镜 #{s.get('shot_number', '?')} 描述过短 ({len(desc.split())} 词)")
            deduction += 3

        duration = s.get("duration", 0)
        if duration <= 0:
            issues.append(f"分镜 #{s.get('shot_number', '?')} 时长无效 ({duration}s)")
            deduction += 5

    total_dur = sum(s.get("duration", 0) for s in shots)
    if total_dur > 120:
        issues.append(f"总时长过长 ({total_dur:.0f}s，短视频建议 ≤60s)")
        deduction += 5

    return deduction, issues


def review_style(style_description: str) -> tuple[int, list[str]]:
    """审查风格描述质量。返回 (扣分, 问题列表)。"""
    if not style_description:
        return 15, ["缺少风格描述"]
    if len(style_description.split()) < 5:
        return 8, [f"风格描述过短 ({len(style_description.split())} 词)"]
    return 0, []


def review_canvas_commands(commands: list[dict[str, Any]]) -> tuple[int, list[str]]:
    """审查画布指令队列。返回 (扣分, 问题列表)。"""
    if not commands:
        return 20, ["无画布指令"]
    if len(commands) < 3:
        return 10, [f"画布指令过少 ({len(commands)})"]
    return 0, []


def run_full_review(
    characters: list[dict[str, Any]],
    shots: list[dict[str, Any]],
    style_description: str,
    canvas_commands: list[dict[str, Any]],
) -> dict[str, Any]:
    """执行完整质量审查。返回 ReviewResult 兼容 dict。"""
    score = 100
    all_issues: list[str] = []
    suggestions: list[str] = []

    # Character review
    d, issues = review_characters(characters)
    score -= d
    all_issues.extend(issues)

    # Shot review
    d, issues = review_shots(shots)
    score -= d
    all_issues.extend(issues)

    # Style review
    d, issues = review_style(style_description)
    score -= d
    all_issues.extend(issues)

    # Canvas review
    d, issues = review_canvas_commands(canvas_commands)
    score -= d
    all_issues.extend(issues)

    score = max(score, 0)
    passed = score >= 70 and len(all_issues) <= 3

    # Auto-generate suggestions
    if any("外貌" in i or "角色" in i for i in all_issues):
        suggestions.append("建议增强角色外貌描述，确保包含发色+服装+体型+独特标识")
    if any("分镜" in i for i in all_issues):
        suggestions.append("建议补充分镜描述，每镜头至少 30 词，包含首帧画面+运镜")
    if any("风格" in i for i in all_issues):
        suggestions.append("建议添加风格描述，包含色调+光照+材质+情绪关键词")

    logger.info(f"Review complete: score={score}, passed={passed}, issues={len(all_issues)}")
    return {
        "passed": passed,
        "score": score,
        "issues": all_issues,
        "suggestions": suggestions,
        "reviewer": "auto",
    }
