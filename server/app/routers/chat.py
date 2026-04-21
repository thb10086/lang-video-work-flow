"""
WebSocket Chat Router — 前端↔后端双向通信

消息协议 (JSON):
  前端→后端:
    { "type": "user_message", "content": "...", "images": ["base64..."], "session_id": "..." }
    { "type": "canvas_result", "command_id": "...", "success": true, "data": {...} }

  后端→前端:
    { "type": "assistant_message", "content": "...", "phase": "..." }
    { "type": "canvas_command", "command_id": "...", "action": "...", "payload": {...} }
    { "type": "tool_call", "name": "...", "status": "running|done", "result": "..." }
    { "type": "phase_update", "phase": "...", "progress": 0.0-1.0 }
    { "type": "error", "message": "..." }
    { "type": "complete", "summary": "..." }
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.agents.orchestrator import compile_orchestrator
from app.agents.state import create_initial_state

logger = logging.getLogger("prism.ws.chat")
router = APIRouter(tags=["chat"])

# ── Active sessions ──
_sessions: dict[str, dict[str, Any]] = {}


async def _send(ws: WebSocket, msg_type: str, **kwargs: Any) -> None:
    """Send a typed JSON message to the client."""
    await ws.send_json({"type": msg_type, **kwargs})


async def _run_orchestrator(
    ws: WebSocket,
    session_id: str,
    user_input: str,
    user_images: list[str],
) -> None:
    """Run the LangGraph orchestrator and stream results to client."""
    state = create_initial_state(
        session_id=session_id,
        user_input=user_input,
        user_images=user_images,
    )

    await _send(ws, "phase_update", phase="init", progress=0.0)

    try:
        graph = compile_orchestrator()

        # Stream node-by-node execution
        phase_progress: dict[str, float] = {
            "scenario": 0.1,
            "planning": 0.25,
            "design": 0.5,
            "cinematography": 0.65,
            "building": 0.8,
            "executing": 0.9,
            "reviewing": 0.95,
            "complete": 1.0,
        }

        async for event in graph.astream(state, stream_mode="updates"):
            for node_name, node_output in event.items():
                if not isinstance(node_output, dict):
                    continue

                # Extract messages for client
                messages = node_output.get("messages", [])
                for msg in messages:
                    content = msg.content if hasattr(msg, "content") else str(msg)
                    await _send(ws, "assistant_message", content=content, node=node_name)

                # Phase update
                phase = node_output.get("phase", "")
                if phase:
                    progress = phase_progress.get(phase, 0.5)
                    await _send(ws, "phase_update", phase=phase, progress=progress)

                # Canvas commands — send to frontend for execution
                commands = node_output.get("canvas_commands", [])
                for cmd in commands:
                    cmd_id = str(uuid.uuid4())[:8]
                    await _send(
                        ws,
                        "canvas_command",
                        command_id=cmd_id,
                        action=cmd.get("action", ""),
                        payload=cmd.get("payload", {}),
                    )

                # Review result
                review = node_output.get("review")
                if review and isinstance(review, dict):
                    await _send(
                        ws,
                        "review_result",
                        passed=review.get("passed", False),
                        score=review.get("score", 0),
                        issues=review.get("issues", []),
                        suggestions=review.get("suggestions", []),
                    )

        # Final completion
        await _send(ws, "phase_update", phase="complete", progress=1.0)
        await _send(ws, "complete", summary="工作流编排完成")

    except Exception as e:
        logger.error(f"Orchestrator error in session {session_id}: {e}", exc_info=True)
        await _send(ws, "error", message=f"编排引擎错误: {str(e)[:200]}")


@router.websocket("/ws/chat")
async def websocket_chat(ws: WebSocket) -> None:
    """WebSocket 聊天端点。"""
    await ws.accept()
    session_id = str(uuid.uuid4())
    _sessions[session_id] = {"ws": ws, "task": None}
    logger.info(f"WS connected: {session_id}")

    await _send(ws, "connected", session_id=session_id)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send(ws, "error", message="Invalid JSON")
                continue

            msg_type = msg.get("type", "")

            if msg_type == "user_message":
                content = msg.get("content", "")
                images = msg.get("images", [])

                if not content and not images:
                    await _send(ws, "error", message="消息内容不能为空")
                    continue

                # Cancel any running task
                existing_task = _sessions[session_id].get("task")
                if existing_task and not existing_task.done():
                    existing_task.cancel()

                # Start orchestrator in background
                task = asyncio.create_task(
                    _run_orchestrator(ws, session_id, content, images)
                )
                _sessions[session_id]["task"] = task

            elif msg_type == "canvas_result":
                # Frontend reports canvas command execution result
                cmd_id = msg.get("command_id", "")
                success = msg.get("success", False)
                data = msg.get("data", {})
                logger.info(f"Canvas result: cmd={cmd_id}, success={success}")
                # Future: feed back into orchestrator state

            elif msg_type == "ping":
                await _send(ws, "pong")

            else:
                await _send(ws, "error", message=f"Unknown message type: {msg_type}")

    except WebSocketDisconnect:
        logger.info(f"WS disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WS error in session {session_id}: {e}", exc_info=True)
    finally:
        # Cleanup
        existing_task = _sessions.get(session_id, {}).get("task")
        if existing_task and not existing_task.done():
            existing_task.cancel()
        _sessions.pop(session_id, None)
