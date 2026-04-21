"""
VideoProjectState — LangGraph 共享状态定义

所有 Agent 节点通过此 State 通信。
使用 TypedDict + Annotated 实现 reducer 语义（消息追加、计数器递增等）。

状态流转:
  user_input → detect_scenario → plan → [screenwriter → artist → cinematographer] → review → output
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, Literal, TypedDict

from langchain_core.messages import AnyMessage


# ── Reducers ──

def _replace(existing: Any, new: Any) -> Any:
    """Reducer: 新值覆盖旧值（默认行为）。"""
    return new


# ── Sub-State Types ──

class ScenarioInfo(TypedDict, total=False):
    """场景识别结果。"""
    scenario_id: str          # comic_drama / product_ad / store_tour / tutorial / short_drama / music_video
    label: str                # 中文标签
    confidence: float         # 0.0 ~ 1.0
    template_id: str | None   # 匹配的模板 ID
    pipeline: str             # 推荐 pipeline 描述
    tips: str                 # 制作建议


class ShotSpec(TypedDict, total=False):
    """单个镜头规格。"""
    shot_number: int
    description: str          # 镜头描述
    dialogue: str             # 对话/旁白
    duration: float           # 秒
    camera_move: str          # 运镜: static / pan / dolly / crane / tracking
    emotion_intensity: int    # 1-10
    characters_present: list[str]


class CharacterSpec(TypedDict, total=False):
    """角色外貌规格。"""
    name: str
    appearance: str           # 英文外貌描述
    role: str                 # 角色定位: protagonist / supporting / extra
    grid_node_id: str | None  # 前端画布中的 characterGrid 节点 ID


class ReviewResult(TypedDict, total=False):
    """审核结果。"""
    passed: bool
    score: int                # 0-100
    issues: list[str]
    suggestions: list[str]
    reviewer: str             # 审核者: director / auto


# ── Main State ──

class VideoProjectState(TypedDict, total=False):
    """
    LangGraph 全局共享状态。

    字段分组:
    1. 会话上下文 — 用户输入、消息历史
    2. 场景 & 计划 — 场景识别、剧本大纲
    3. 角色 & 风格 — 角色列表、风格锁定
    4. 分镜 & 脚本 — 分镜列表
    5. 画布操作 — 待发送到前端的指令队列
    6. 审核 & 控制流 — 审核结果、重试计数、当前阶段
    """

    # ── 1. 会话上下文 ──
    messages: Annotated[list[AnyMessage], operator.add]  # 追加式 reducer
    user_input: str                                       # 当前轮用户原始输入
    user_images: list[str]                                # 用户上传的图片 (URL/base64)
    session_id: str                                       # WebSocket 会话 ID
    project_id: str                                       # 项目 ID (MySQL)

    # ── 2. 场景 & 计划 ──
    scenario: ScenarioInfo                                # 场景识别结果
    synopsis: str                                         # 剧本大纲 (编剧产出)
    title: str                                            # 作品标题

    # ── 3. 角色 & 风格 ──
    characters: list[CharacterSpec]                       # 角色列表 (编剧+美术协作)
    style_description: str                                # 风格描述 (美术产出)
    style_reference_urls: list[str]                       # 风格参考图 URL

    # ── 4. 分镜 & 脚本 ──
    shots: list[ShotSpec]                                 # 分镜列表 (摄影师产出)
    total_duration: float                                 # 总时长 (秒)

    # ── 5. 画布操作 ──
    canvas_commands: Annotated[list[dict[str, Any]], operator.add]  # 追加式
    # 每个 command: { "action": "create_node"|"connect"|"execute"|..., "payload": {...} }

    # ── 6. 审核 & 控制流 ──
    phase: Literal[
        "init",           # 初始
        "scenario",       # 场景识别
        "planning",       # 编剧规划
        "design",         # 美术设计
        "cinematography", # 摄影分镜
        "building",       # 画布构建
        "executing",      # 节点执行
        "reviewing",      # 质量审核
        "complete",       # 完成
        "error",          # 错误
    ]
    review: ReviewResult                                  # 最新审核结果
    retry_count: Annotated[int, _replace]                 # 当前阶段重试次数
    max_retries: int                                      # 最大重试次数 (默认 3)
    error_message: str                                    # 错误信息


# ── Initial State Factory ──

def create_initial_state(
    session_id: str,
    project_id: str = "",
    user_input: str = "",
    user_images: list[str] | None = None,
) -> VideoProjectState:
    """创建初始状态。"""
    return VideoProjectState(
        messages=[],
        user_input=user_input,
        user_images=user_images or [],
        session_id=session_id,
        project_id=project_id,
        scenario=ScenarioInfo(),
        synopsis="",
        title="",
        characters=[],
        style_description="",
        style_reference_urls=[],
        shots=[],
        total_duration=0.0,
        canvas_commands=[],
        phase="init",
        review=ReviewResult(),
        retry_count=0,
        max_retries=3,
        error_message="",
    )
