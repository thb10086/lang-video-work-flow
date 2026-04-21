"""
Director Orchestrator — LangGraph StateGraph

导演编排图：9 个节点 + 条件边 + 审核循环。

流转:
  START → detect_scenario → plan_story → design_style → design_characters
        → plan_shots → build_canvas → execute_canvas → review_gate
        → (pass) END  /  (fail & retry < max) → 回退到对应阶段

节点职责:
  - detect_scenario:   场景识别（关键词匹配，零 LLM）
  - plan_story:        编剧规划（LLM: 大纲 + 角色列表）
  - design_style:      风格锁定（LLM: 风格描述 + 参考图建议）— 先于角色，确保角色/场景风格一致
  - design_characters: 美术设计（LLM: 角色外貌描述，继承已锁定风格）
  - plan_shots:        摄影分镜（LLM: 分镜列表 + 运镜）
  - build_canvas:      画布构建（生成 canvas_commands 指令队列）
  - execute_canvas:    画布执行（通过 WebSocket 发送指令到前端）
  - review_gate:       质量审核（自动评分 + 条件路由）
  - handle_error:      错误处理
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import AIMessage
from langgraph.graph import END, START, StateGraph

from app.agents.state import (
    ScenarioInfo,
    VideoProjectState,
)
from app.agents.screenwriter import run_screenwriter
from app.agents.artist import run_design_characters, run_design_style
from app.agents.cinematographer import run_plan_shots
from app.agents.review_gate import run_review_gate
from app.tools.canvas_tools import build_workflow_commands

logger = logging.getLogger("prism.orchestrator")

# LLM instances are managed within each specialist agent module.


# ============================================================
# Graph Nodes
# ============================================================

SCENARIO_KEYWORDS: dict[str, list[str]] = {
    "comic_drama": ["漫剧", "漫画", "动漫", "二次元", "anime", "番剧", "卡通"],
    "product_ad": ["产品", "广告", "电商", "商品", "带货", "品牌", "促销", "15秒", "30秒"],
    "store_tour": ["探店", "vlog", "打卡", "美食", "餐厅", "旅行", "门店"],
    "tutorial": ["教程", "解说", "科普", "知识", "讲解", "培训", "课程"],
    "short_drama": ["短剧", "微短剧", "剧情", "故事", "人物", "情节", "悬疑"],
    "music_video": ["MV", "音乐", "混剪", "剪辑", "节奏", "歌曲", "舞蹈"],
}

SCENARIO_LABELS: dict[str, str] = {
    "comic_drama": "漫剧/动漫短剧",
    "product_ad": "产品广告/电商",
    "store_tour": "探店/Vlog",
    "tutorial": "教程/解说",
    "short_drama": "短剧/微短剧",
    "music_video": "MV/混剪",
}

TEMPLATE_MAP: dict[str, str] = {
    "comic_drama": "comic-drama-basic",
    "product_ad": "ad-product",
    "store_tour": "store-tour-vlog",
    "tutorial": "tutorial-basic",
    "short_drama": "short-film-basic",
    "music_video": "music-video-montage",
}


async def detect_scenario_node(state: VideoProjectState) -> dict[str, Any]:
    """场景识别 — 纯关键词评分，零 LLM 调用。"""
    text = state.get("user_input", "").lower()
    scores: dict[str, int] = {}
    for sid, keywords in SCENARIO_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw.lower() in text)
        if score > 0:
            scores[sid] = score

    if not scores:
        best_id = "short_drama"
        confidence = 0.3
    else:
        best_id = max(scores, key=scores.get)  # type: ignore[arg-type]
        confidence = min(scores[best_id] / 3.0, 1.0)

    scenario = ScenarioInfo(
        scenario_id=best_id,
        label=SCENARIO_LABELS.get(best_id, best_id),
        confidence=confidence,
        template_id=TEMPLATE_MAP.get(best_id),
        pipeline=f"{SCENARIO_LABELS.get(best_id, '')} 标准 pipeline",
        tips=f"识别为 {SCENARIO_LABELS.get(best_id, best_id)}",
    )

    logger.info(f"Scenario detected: {best_id} (confidence={confidence:.1%})")
    return {
        "scenario": scenario,
        "phase": "scenario",
        "messages": [AIMessage(content=f"[场景识别] {scenario['label']} (置信度 {confidence:.0%})")],
    }


async def plan_story_node(state: VideoProjectState) -> dict[str, Any]:
    """编剧规划 — 委派给 screenwriter agent。"""
    return await run_screenwriter(state)


async def design_characters_node(state: VideoProjectState) -> dict[str, Any]:
    """美术设计 — 委派给 artist agent。"""
    return await run_design_characters(state)


async def design_style_node(state: VideoProjectState) -> dict[str, Any]:
    """风格锁定 — 委派给 artist agent。"""
    return await run_design_style(state)


async def plan_shots_node(state: VideoProjectState) -> dict[str, Any]:
    """摄影分镜 — 委派给 cinematographer agent。"""
    return await run_plan_shots(state)


async def build_canvas_node(state: VideoProjectState) -> dict[str, Any]:
    """画布构建 — 委派给 canvas_tools 生成指令队列。"""
    scenario = state.get("scenario", {})
    commands = build_workflow_commands(
        scenario_id=scenario.get("scenario_id", "short_drama"),
        template_id=scenario.get("template_id"),
        characters=state.get("characters", []),
        style_desc=state.get("style_description", ""),
        shots=state.get("shots", []),
    )
    return {
        "canvas_commands": commands,
        "phase": "building",
        "messages": [AIMessage(content=f"[画布] 生成 {len(commands)} 条画布指令")],
    }


async def execute_canvas_node(state: VideoProjectState) -> dict[str, Any]:
    """画布执行 — 标记状态为 executing，等待前端完成。

    实际执行通过 WebSocket 发送 canvas_commands 到前端。
    此节点仅做状态转换，真正的 WS 通信在 P3-04 实现。
    """
    commands = state.get("canvas_commands", [])
    logger.info(f"Executing canvas: {len(commands)} commands pending")
    return {
        "phase": "executing",
        "messages": [AIMessage(content=f"[执行] 发送 {len(commands)} 条指令到前端画布")],
    }


async def review_gate_node(state: VideoProjectState) -> dict[str, Any]:
    """质量审核门 — 委派给 review_gate 模块。"""
    return await run_review_gate(state)


async def handle_error_node(state: VideoProjectState) -> dict[str, Any]:
    """错误处理节点。"""
    error = state.get("error_message", "未知错误")
    logger.error(f"Pipeline error: {error}")
    return {
        "phase": "error",
        "messages": [AIMessage(content=f"[错误] {error}")],
    }


# ============================================================
# Conditional Edges
# ============================================================

def route_after_review(state: VideoProjectState) -> str:
    """审核后路由：通过 → END，失败 → 回退重试或 END。"""
    review = state.get("review", {})
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 3)

    if review.get("passed", False):
        return "complete"

    if retry_count >= max_retries:
        logger.warning(f"Max retries reached ({max_retries}), ending pipeline")
        return "complete"

    # Route back based on issues
    issues_text = " ".join(review.get("issues", []))
    if "角色" in issues_text or "外貌" in issues_text:
        return "retry_characters"
    if "分镜" in issues_text:
        return "retry_shots"
    return "retry_canvas"


def route_after_scenario(state: VideoProjectState) -> str:
    """场景识别后：有错误 → error，否则 → plan_story。"""
    if state.get("phase") == "error":
        return "error"
    return "plan_story"


# ============================================================
# Graph Builder
# ============================================================

def build_orchestrator_graph() -> StateGraph:
    """构建导演编排 StateGraph。"""
    graph = StateGraph(VideoProjectState)

    # ── Add nodes ──
    graph.add_node("detect_scenario", detect_scenario_node)
    graph.add_node("plan_story", plan_story_node)
    graph.add_node("design_characters", design_characters_node)
    graph.add_node("design_style", design_style_node)
    graph.add_node("plan_shots", plan_shots_node)
    graph.add_node("build_canvas", build_canvas_node)
    graph.add_node("execute_canvas", execute_canvas_node)
    graph.add_node("review_gate", review_gate_node)
    graph.add_node("handle_error", handle_error_node)

    # ── Edges: linear pipeline ──
    graph.add_edge(START, "detect_scenario")
    graph.add_conditional_edges("detect_scenario", route_after_scenario, {
        "plan_story": "plan_story",
        "error": "handle_error",
    })
    graph.add_edge("plan_story", "design_style")
    graph.add_edge("design_style", "design_characters")
    graph.add_edge("design_characters", "plan_shots")
    graph.add_edge("plan_shots", "build_canvas")
    graph.add_edge("build_canvas", "execute_canvas")
    graph.add_edge("execute_canvas", "review_gate")

    # ── Review routing ──
    graph.add_conditional_edges("review_gate", route_after_review, {
        "complete": END,
        "retry_characters": "design_characters",
        "retry_shots": "plan_shots",
        "retry_canvas": "build_canvas",
    })

    graph.add_edge("handle_error", END)

    return graph


def compile_orchestrator():
    """编译导演编排图为可执行 Runnable。"""
    graph = build_orchestrator_graph()
    return graph.compile()
