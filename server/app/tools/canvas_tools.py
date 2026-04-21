"""
Canvas Tools — 画布操作工具（通过 WebSocket 调前端）

这些工具生成指令，由 WebSocket 层发送到前端执行。
每个工具返回一个 canvas_command dict，orchestrator 收集后统一发送。
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("prism.tools.canvas")


def cmd_generate_workflow(scenario_id: str, template_id: str | None = None) -> dict[str, Any]:
    """生成工作流指令。"""
    return {
        "action": "generate_workflow",
        "payload": {"scenario": scenario_id, "template_id": template_id},
    }


def cmd_create_node(node_type: str, label: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    """创建节点指令。"""
    return {
        "action": "create_node",
        "payload": {"type": node_type, "label": label, "data": data or {}},
    }


def cmd_update_node(
    node_label: str,
    field: str,
    value: Any,
    node_id: str | None = None,
) -> dict[str, Any]:
    """更新节点字段指令。"""
    payload: dict[str, Any] = {"field": field, "value": value}
    if node_id:
        payload["nodeId"] = node_id
    else:
        payload["nodeLabel"] = node_label
    return {"action": "update_node", "payload": payload}


def cmd_connect_nodes(
    source_label: str,
    target_label: str,
    source_id: str | None = None,
    target_id: str | None = None,
) -> dict[str, Any]:
    """连接节点指令。"""
    payload: dict[str, Any] = {}
    if source_id:
        payload["sourceId"] = source_id
    else:
        payload["sourceLabel"] = source_label
    if target_id:
        payload["targetId"] = target_id
    else:
        payload["targetLabel"] = target_label
    return {"action": "connect_nodes", "payload": payload}


def cmd_execute_node(node_label: str, node_id: str | None = None) -> dict[str, Any]:
    """执行节点指令。"""
    payload: dict[str, Any] = {}
    if node_id:
        payload["nodeId"] = node_id
    else:
        payload["nodeLabel"] = node_label
    return {"action": "execute_node", "payload": payload}


def cmd_batch_execute(labels: list[str]) -> dict[str, Any]:
    """串行批量执行指令。"""
    return {"action": "batch_execute", "payload": {"labels": labels}}


def cmd_inject_images(
    targets: list[dict[str, Any]],
) -> dict[str, Any]:
    """注入图片指令。"""
    return {"action": "inject_user_images", "payload": {"targets": targets}}


def cmd_get_canvas_state() -> dict[str, Any]:
    """获取画布状态指令。"""
    return {"action": "get_canvas_state", "payload": {}}


def build_workflow_commands(
    scenario_id: str,
    template_id: str | None,
    characters: list[dict[str, Any]],
    style_desc: str,
    shots: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """从 State 数据构建完整的画布指令序列。"""
    commands: list[dict[str, Any]] = []

    # 1. Generate base workflow
    commands.append(cmd_generate_workflow(scenario_id, template_id))

    # 2. Fill character data
    for i, char in enumerate(characters):
        commands.append(cmd_update_node(
            node_label=f"角色{i + 1}",
            field="prompt",
            value=char.get("appearance", ""),
        ))

    # 3. Fill style
    if style_desc:
        commands.append(cmd_update_node(
            node_label="风格锁定",
            field="styleDescription",
            value=style_desc,
        ))

    # 4. Fill shots
    for shot in shots:
        commands.append(cmd_update_node(
            node_label=f"关键帧{shot.get('shot_number', '')}",
            field="prompt",
            value=shot.get("description", ""),
        ))

    logger.info(f"Built {len(commands)} canvas commands")
    return commands
