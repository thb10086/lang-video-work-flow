"""
Cinematographer Agent — 摄影指导专家

职责：
  - 将剧本大纲转化为分镜列表
  - 为每个镜头指定运镜方案、景别、时长
  - 确保角色出场时带上外貌锚定词
  - 控制节奏：情绪曲线 + 时长分配
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.agents.state import ShotSpec, VideoProjectState
from app.config import settings

logger = logging.getLogger("prism.cinematographer")

CINEMATOGRAPHER_SYSTEM = """You are a cinematographer for AI video production.

## Camera Movement Dictionary
| Type | Keywords | Effect | AI Compatibility |
|------|----------|--------|-----------------|
| Dolly in | slow dolly-in, push in | Focus, reveal, tension | ★★★ All models |
| Dolly out | pull back, dolly out | Distance, isolation | ★★★ All models |
| Tracking | tracking shot, follow from behind/side | Immersion, pursuit | ★★☆ VEO/Seedance |
| Orbit | orbit, arc shot, 360° around | Showcase, epic | ★★☆ VEO/Seedance |
| Tilt | tilt up/down | Reverence/oppression | ★★★ All models |
| Crane | crane rise/descend | Grand/descending | ★★☆ VEO |
| Pan | pan left/right | Exploration, establishing | ★★★ All models |
| Static | static locked-off, tripod | Stable, objective | ★★★ All models |
| Slider | slider shot, lateral tracking | Smooth transition | ★★★ All models |

## Shot Scale
- EWS (Extreme Wide): subject <10% frame — establishing, landscape
- WS (Wide): full body + environment — context setting
- MWS (Medium Wide): knee up — walking, group interaction
- MS (Medium): waist up — dialogue, standard coverage
- MCU (Medium Close-Up): chest up — emotion, reaction
- CU (Close-Up): face fills frame — intense emotion, detail
- ECU (Extreme Close-Up): single feature — eyes, hands, object detail

## First-Frame Anchoring
The first frame of each video clip determines the visual baseline. Describe it with maximum precision:
- Character positions and poses
- Environment details visible in frame
- Lighting direction and quality
- Camera angle and lens feel

## Rhythm Control
- Action/tension: 3-4s per shot, fast cuts
- Dialogue: 5-8s per shot
- Atmospheric/beauty: 6-10s per shot
- Transitions: match on action or match on color

Always respond in valid JSON, no markdown wrapping."""

SCENARIO_SHOT_HINTS: dict[str, str] = {
    "comic_drama": "Use dynamic angles (low angle hero shots, dutch angles for tension). 4-6 shots, 4-5s each. Emphasize character expressions with MCU/CU.",
    "product_ad": "Clean, controlled shots. Start with product hero (static/orbit), then lifestyle context (tracking), end with logo (static). 3-5 shots, 3-5s each.",
    "store_tour": "First-person feel with tracking/dolly. Multiple location changes. 5-8 shots, 4-6s each. Use crane for establishing shots.",
    "tutorial": "Mostly static/slider for clarity. Screen recording or diagram focus. 4-6 shots, 5-8s each. MCU for host, WS for setup.",
    "short_drama": "Cinematic coverage: establishing WS → dialogue MS → emotion CU. 5-8 shots, 4-6s each. Match on action transitions.",
    "music_video": "Beat-synced fast cuts. High emotion intensity (7-10). Style-first with dramatic lighting. 6-10 shots, 3-4s each.",
}


def _get_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.DEFAULT_LLM_MODEL,
        base_url=f"{settings.LLM_BASE_URL}/v1",
        api_key=settings.LLM_API_KEY,
        temperature=0.7,
        max_tokens=3000,
    )


async def run_plan_shots(state: VideoProjectState) -> dict[str, Any]:
    """摄影分镜：生成分镜列表。"""
    llm = _get_llm()
    synopsis = state.get("synopsis", "")
    characters = state.get("characters", [])
    style = state.get("style_description", "")
    scenario = state.get("scenario", {})
    scenario_id = scenario.get("scenario_id", "short_drama")

    char_anchors = "\n".join(
        f"- {c.get('name', '?')}: {c.get('appearance', '')[:80]}"
        for c in characters
    )
    hint = SCENARIO_SHOT_HINTS.get(scenario_id, "5-8 shots, 4-6s each.")

    prompt = f"""Create a detailed shot list for this video project.

Scenario: {scenario.get('label', 'short film')}
Synopsis: {synopsis}
Visual style: {style}
Character anchors (MUST include in shot descriptions when character appears):
{char_anchors or 'No characters defined'}

Genre hint: {hint}

For each shot, write the description as a FIRST-FRAME description (what the camera sees in the opening frame)
followed by the camera movement. Include character appearance anchors when they appear.

Return JSON array (no markdown):
[{{
  "shot_number": 1,
  "description": "English first-frame description + camera movement (40-60 words). Include character anchors.",
  "dialogue": "对话或旁白 (Chinese, empty string if none)",
  "duration": 5,
  "camera_move": "static|pan|dolly|crane|tracking|orbit|tilt|slider",
  "emotion_intensity": 5,
  "characters_present": ["角色名"]
}}]"""

    resp = await llm.ainvoke([
        SystemMessage(content=CINEMATOGRAPHER_SYSTEM),
        HumanMessage(content=prompt),
    ])

    try:
        raw = str(resp.content).replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)
        shots = [
            ShotSpec(
                shot_number=s.get("shot_number", i + 1),
                description=s.get("description", ""),
                dialogue=s.get("dialogue", ""),
                duration=float(s.get("duration", 5)),
                camera_move=s.get("camera_move", "static"),
                emotion_intensity=int(s.get("emotion_intensity", 5)),
                characters_present=s.get("characters_present", []),
            )
            for i, s in enumerate(data)
        ]
    except (json.JSONDecodeError, AttributeError) as e:
        logger.error(f"Cinematographer JSON parse error: {e}")
        return {
            "phase": "error",
            "error_message": f"摄影分镜格式错误: {str(resp.content)[:200]}",
            "messages": [AIMessage(content="[摄影] 分镜生成失败")],
        }

    total_dur = sum(s.get("duration", 5) for s in shots)
    logger.info(f"Shots planned: {len(shots)} shots, ~{total_dur:.0f}s")
    return {
        "shots": shots,
        "total_duration": total_dur,
        "phase": "cinematography",
        "messages": [AIMessage(content=f"[摄影] {len(shots)} 个分镜完成 (~{total_dur:.0f}s)")],
    }
