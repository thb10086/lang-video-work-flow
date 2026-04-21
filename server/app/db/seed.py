"""
Database Seed Script — 将现有硬编码模型/渠道定义灌入数据库。

Usage:
    cd server
    python -m app.db.seed

幂等：会先清空再插入，可重复执行。
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.ai_model import AiModel
from app.models.ai_channel import AiChannel
from app.models.channel_model_mapping import ChannelModelMapping

logger = logging.getLogger("prism.seed")

# ════════════════════════════════════════════════════════════════
# 1. 渠道种子数据
# ════════════════════════════════════════════════════════════════

CHANNELS_SEED = [
    {
        "channel_id": "yunwu",
        "name": "Yunwu.ai",
        "base_url": settings.LLM_BASE_URL,
        "api_key": settings.LLM_API_KEY,
        "adapter_type": "gemini",
        "config_json": {"timeout": 120, "description": "LLM + Gemini 图片生成"},
    },
    {
        "channel_id": "yunwu-llm",
        "name": "Yunwu.ai (LLM)",
        "base_url": settings.LLM_BASE_URL,
        "api_key": settings.LLM_API_KEY,
        "adapter_type": "openai",
        "config_json": {"timeout": 60, "description": "OpenAI 兼容 LLM Chat"},
    },
    {
        "channel_id": "puyo",
        "name": "Puyo",
        "base_url": settings.CHANNEL_PUYO_URL,
        "api_key": settings.CHANNEL_PUYO_KEY,
        "adapter_type": "puyo",
        "config_json": {"timeout": 600, "max_concurrent": 1},
    },
    {
        "channel_id": "apimart",
        "name": "APIMart",
        "base_url": settings.CHANNEL_APIMART_URL,
        "api_key": settings.CHANNEL_APIMART_KEY,
        "adapter_type": "apimart",
        "config_json": {"timeout": 600, "max_concurrent": 3},
    },
]

# ════════════════════════════════════════════════════════════════
# 2. 模型种子数据
# ════════════════════════════════════════════════════════════════

MODELS_SEED = [
    # ── 图片模型 ──
    {
        "model_id": "gemini-3.1-flash-image-preview",
        "name": "Gemini 3.1 Flash Image",
        "provider": "Google",
        "capability": "image",
        "description": "快速图片生成，适合迭代和预览",
        "sort_order": 10,
        "param_schema": [
            {"key": "aspectRatio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [
                 {"label": "1:1 (方形)", "value": "1:1"}, {"label": "2:3 (竖版)", "value": "2:3"},
                 {"label": "3:2 (横版)", "value": "3:2"}, {"label": "3:4", "value": "3:4"},
                 {"label": "4:3", "value": "4:3"}, {"label": "4:5", "value": "4:5"},
                 {"label": "5:4", "value": "5:4"}, {"label": "9:16 (竖屏)", "value": "9:16"},
                 {"label": "16:9 (横屏)", "value": "16:9"}, {"label": "21:9 (超宽)", "value": "21:9"},
             ]},
            {"key": "imageSize", "label": "尺寸", "type": "select", "required": False, "default": "2k",
             "options": [{"label": "1K", "value": "1k"}, {"label": "2K", "value": "2k"}, {"label": "4K", "value": "4k"}]},
        ],
    },
    {
        "model_id": "gemini-3-pro-image-preview",
        "name": "Gemini 3 Pro Image",
        "provider": "Google",
        "capability": "image",
        "description": "高质量图片生成，适合最终输出",
        "sort_order": 20,
        "param_schema": [
            {"key": "aspectRatio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [
                 {"label": "1:1 (方形)", "value": "1:1"}, {"label": "2:3 (竖版)", "value": "2:3"},
                 {"label": "3:2 (横版)", "value": "3:2"}, {"label": "3:4", "value": "3:4"},
                 {"label": "4:3", "value": "4:3"}, {"label": "4:5", "value": "4:5"},
                 {"label": "5:4", "value": "5:4"}, {"label": "9:16 (竖屏)", "value": "9:16"},
                 {"label": "16:9 (横屏)", "value": "16:9"}, {"label": "21:9 (超宽)", "value": "21:9"},
             ]},
            {"key": "imageSize", "label": "尺寸", "type": "select", "required": False, "default": "2k",
             "options": [{"label": "1K", "value": "1k"}, {"label": "2K", "value": "2k"}, {"label": "4K", "value": "4k"}]},
        ],
    },

    # ── LLM 模型 ──
    {
        "model_id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro",
        "provider": "Google",
        "capability": "text",
        "description": "强大的多模态推理模型",
        "sort_order": 10,
        "param_schema": [
            {"key": "temperature", "label": "温度", "type": "slider", "required": False, "default": 0.7, "min": 0, "max": 2, "step": 0.1},
            {"key": "max_tokens", "label": "最大Token", "type": "number", "required": False, "default": 2000},
        ],
    },
    {
        "model_id": "gpt-5.4",
        "name": "GPT 5.4",
        "provider": "OpenAI",
        "capability": "text",
        "description": "OpenAI 最新旗舰模型",
        "sort_order": 20,
        "param_schema": [
            {"key": "temperature", "label": "温度", "type": "slider", "required": False, "default": 0.7, "min": 0, "max": 2, "step": 0.1},
            {"key": "max_tokens", "label": "最大Token", "type": "number", "required": False, "default": 4096},
        ],
    },
    {
        "model_id": "gpt-4o",
        "name": "GPT 4o",
        "provider": "OpenAI",
        "capability": "text",
        "description": "高性价比多模态模型",
        "sort_order": 30,
        "param_schema": [
            {"key": "temperature", "label": "温度", "type": "slider", "required": False, "default": 0.7, "min": 0, "max": 2, "step": 0.1},
            {"key": "max_tokens", "label": "最大Token", "type": "number", "required": False, "default": 4096},
        ],
    },
    {
        "model_id": "claude-sonnet-4-20250514",
        "name": "Claude Sonnet 4",
        "provider": "Anthropic",
        "capability": "text",
        "description": "Anthropic 编码与推理模型",
        "sort_order": 40,
        "param_schema": [
            {"key": "temperature", "label": "温度", "type": "slider", "required": False, "default": 0.7, "min": 0, "max": 1, "step": 0.1},
            {"key": "max_tokens", "label": "最大Token", "type": "number", "required": False, "default": 4096},
        ],
    },

    # ── 视频模型 ──
    {
        "model_id": "doubao-seedance-2-0",
        "name": "Doubao Seedance 2.0",
        "provider": "ByteDance",
        "capability": "video",
        "description": "豆包 Seedance 2.0，支持文生视频/图生视频/首尾帧/参考视频/参考音频/有声视频",
        "sort_order": 10,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 5,
             "options": [{"label": "4秒", "value": 4}, {"label": "5秒", "value": 5}, {"label": "8秒", "value": 8},
                         {"label": "10秒", "value": 10}, {"label": "12秒", "value": 12}, {"label": "15秒", "value": 15}]},
            {"key": "size", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"},
                         {"label": "方形 1:1", "value": "1:1"}, {"label": "传统 4:3", "value": "4:3"},
                         {"label": "竖传统 3:4", "value": "3:4"}, {"label": "超宽 21:9", "value": "21:9"},
                         {"label": "自适应", "value": "adaptive"}]},
            {"key": "resolution", "label": "分辨率", "type": "select", "required": False, "default": "720p",
             "options": [{"label": "480p 标清", "value": "480p"}, {"label": "720p 高清", "value": "720p"}]},
            {"key": "generate_audio", "label": "生成音频", "type": "boolean", "required": False, "default": False, "description": "生成有声视频"},
            {"key": "camera_fixed", "label": "固定镜头", "type": "boolean", "required": False, "default": False, "description": "固定摄像机位"},
            {"key": "return_last_frame", "label": "返回末帧", "type": "boolean", "required": False, "default": False, "description": "返回视频末帧图片"},
            {"key": "seed", "label": "随机种子", "type": "number", "required": False, "placeholder": "留空随机", "description": "相同种子产生相似结果"},
        ],
    },
    {
        "model_id": "doubao-seedance-2-0-fast",
        "name": "Doubao Seedance 2.0 Fast",
        "provider": "ByteDance",
        "capability": "video",
        "description": "豆包 Seedance 2.0 快速版，功能同标准版，生成速度更快",
        "sort_order": 15,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 5,
             "options": [{"label": "4秒", "value": 4}, {"label": "5秒", "value": 5}, {"label": "8秒", "value": 8},
                         {"label": "10秒", "value": 10}, {"label": "12秒", "value": 12}, {"label": "15秒", "value": 15}]},
            {"key": "size", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"},
                         {"label": "方形 1:1", "value": "1:1"}, {"label": "传统 4:3", "value": "4:3"},
                         {"label": "竖传统 3:4", "value": "3:4"}, {"label": "超宽 21:9", "value": "21:9"},
                         {"label": "自适应", "value": "adaptive"}]},
            {"key": "resolution", "label": "分辨率", "type": "select", "required": False, "default": "720p",
             "options": [{"label": "480p 标清", "value": "480p"}, {"label": "720p 高清", "value": "720p"}]},
            {"key": "generate_audio", "label": "生成音频", "type": "boolean", "required": False, "default": False, "description": "生成有声视频"},
            {"key": "camera_fixed", "label": "固定镜头", "type": "boolean", "required": False, "default": False, "description": "固定摄像机位"},
            {"key": "return_last_frame", "label": "返回末帧", "type": "boolean", "required": False, "default": False, "description": "返回视频末帧图片"},
            {"key": "seed", "label": "随机种子", "type": "number", "required": False, "placeholder": "留空随机", "description": "相同种子产生相似结果"},
        ],
    },
    {
        "model_id": "veo3.1-fast",
        "name": "VEO 3.1 Fast",
        "provider": "Google",
        "capability": "video",
        "description": "Google VEO 3.1 快速版，60-150s 出片，8s 视频",
        "sort_order": 20,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 8,
             "options": [{"label": "8秒", "value": 8}]},
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"}]},
            {"key": "resolution", "label": "分辨率", "type": "select", "required": False, "default": "720p",
             "options": [{"label": "720p", "value": "720p"}, {"label": "1080p", "value": "1080p"}, {"label": "4K", "value": "4k"}]},
            {"key": "image_mode", "label": "图片模式", "type": "select", "required": False, "default": "frame",
             "options": [{"label": "首尾帧", "value": "frame"}, {"label": "参考图", "value": "reference"}],
             "description": "仅在有图片输入时生效"},
        ],
    },
    {
        "model_id": "veo3.1",
        "name": "VEO 3.1",
        "provider": "Google",
        "capability": "video",
        "description": "Google VEO 3.1 标准版，画质更优，120-300s 出片",
        "sort_order": 25,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 8,
             "options": [{"label": "8秒", "value": 8}]},
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"}]},
            {"key": "resolution", "label": "分辨率", "type": "select", "required": False, "default": "1080p",
             "options": [{"label": "720p", "value": "720p"}, {"label": "1080p", "value": "1080p"}, {"label": "4K", "value": "4k"}]},
            {"key": "image_mode", "label": "图片模式", "type": "select", "required": False, "default": "frame",
             "options": [{"label": "首尾帧", "value": "frame"}, {"label": "参考图", "value": "reference"}]},
        ],
    },
    {
        "model_id": "sora-2-vip",
        "name": "Sora 2 VIP",
        "provider": "OpenAI",
        "capability": "video",
        "description": "OpenAI Sora 2 VIP，高质量视频，10/15s",
        "sort_order": 30,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 10,
             "options": [{"label": "10秒", "value": 10}, {"label": "15秒", "value": 15}]},
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"}]},
            {"key": "style", "label": "风格", "type": "select", "required": False,
             "options": [{"label": "无", "value": ""}, {"label": "动漫", "value": "anime"},
                         {"label": "漫画", "value": "comic"}, {"label": "新闻", "value": "news"},
                         {"label": "自拍", "value": "selfie"}, {"label": "复古", "value": "nostalgic"}]},
            {"key": "watermark", "label": "水印", "type": "boolean", "required": False, "default": False},
        ],
    },
    {
        "model_id": "kling-v3",
        "name": "Kling v3",
        "provider": "Kuaishou",
        "capability": "video",
        "description": "可灵v3，支持首尾帧+有声视频+负面提示词",
        "sort_order": 35,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 5,
             "options": [{"label": "5秒", "value": 5}, {"label": "10秒", "value": 10}, {"label": "15秒", "value": 15}]},
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"}, {"label": "方形 1:1", "value": "1:1"}]},
            {"key": "mode", "label": "质量", "type": "select", "required": False, "default": "std",
             "options": [{"label": "标准 (720P)", "value": "std"}, {"label": "专业 (1080P)", "value": "pro"}]},
            {"key": "negative_prompt", "label": "负面提示词", "type": "textarea", "required": False, "default": "", "placeholder": "模糊, 低画质, 变形"},
            {"key": "audio", "label": "生成音频", "type": "boolean", "required": False, "default": False, "description": "生成有声视频"},
        ],
    },

    # ── 音频模型 (占位) ──
    {
        "model_id": "elevenlabs",
        "name": "ElevenLabs",
        "provider": "ElevenLabs",
        "capability": "audio",
        "description": "语音合成 (TTS)",
        "sort_order": 10,
        "param_schema": [],
    },
    {
        "model_id": "fish-speech",
        "name": "Fish Speech",
        "provider": "Fish Audio",
        "capability": "audio",
        "description": "开源语音合成",
        "sort_order": 20,
        "param_schema": [],
    },
    {
        "model_id": "cosyvoice",
        "name": "CosyVoice",
        "provider": "Alibaba",
        "capability": "audio",
        "description": "阿里语音合成",
        "sort_order": 30,
        "param_schema": [],
    },
]

# ════════════════════════════════════════════════════════════════
# 3. 渠道-模型映射种子数据
#    (model_id_str, channel_id_str, channel_model_id, priority)
# ════════════════════════════════════════════════════════════════

MAPPINGS_SEED = [
    # 图片 → yunwu (Gemini 原生 API)
    ("gemini-3.1-flash-image-preview", "yunwu", "gemini-3.1-flash-image-preview", 0),
    ("gemini-3-pro-image-preview", "yunwu", "gemini-3-pro-image-preview", 0),

    # LLM → yunwu-llm (OpenAI 兼容)
    ("gemini-3.1-pro-preview", "yunwu-llm", "gemini-3.1-pro-preview", 0),
    ("gpt-5.4", "yunwu-llm", "gpt-5.4", 0),
    ("gpt-4o", "yunwu-llm", "gpt-4o", 0),
    ("claude-sonnet-4-20250514", "yunwu-llm", "claude-sonnet-4-20250514", 0),

    # Seedance → apimart
    ("doubao-seedance-2-0", "apimart", "doubao-seedance-2.0", 0),
    ("doubao-seedance-2-0-fast", "apimart", "doubao-seedance-2.0-fast", 0),

    # VEO → apimart (primary), puyo (fallback)
    ("veo3.1-fast", "apimart", "veo3.1-fast", 0),
    ("veo3.1-fast", "puyo", "veo-3-1-fast", 10),
    ("veo3.1", "apimart", "veo3.1-quality", 0),
    ("veo3.1", "puyo", "veo-3-1", 10),

    # Sora → apimart only
    ("sora-2-vip", "apimart", "sora-2-vip", 0),

    # Kling → apimart only
    ("kling-v3", "apimart", "kling-v3", 0),
]


# ════════════════════════════════════════════════════════════════
# 4. 执行逻辑
# ════════════════════════════════════════════════════════════════

async def seed_database() -> None:
    """清空并重新插入种子数据（幂等）。"""
    engine = create_async_engine(settings.database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        async with session.begin():
            # 清空（顺序：先映射，再模型/渠道）
            await session.execute(delete(ChannelModelMapping))
            await session.execute(delete(AiModel))
            await session.execute(delete(AiChannel))

            # 插入渠道
            channel_map: dict[str, AiChannel] = {}
            for ch_data in CHANNELS_SEED:
                ch = AiChannel(**ch_data)
                session.add(ch)
                channel_map[ch_data["channel_id"]] = ch

            # 插入模型
            model_map: dict[str, AiModel] = {}
            for m_data in MODELS_SEED:
                m = AiModel(**m_data)
                session.add(m)
                model_map[m_data["model_id"]] = m

            # flush 获取自增 ID
            await session.flush()

            # 插入映射
            for model_id_str, channel_id_str, channel_model_id, priority in MAPPINGS_SEED:
                model = model_map.get(model_id_str)
                channel = channel_map.get(channel_id_str)
                if not model or not channel:
                    logger.warning(f"Skipping mapping: model={model_id_str}, channel={channel_id_str}")
                    continue
                mapping = ChannelModelMapping(
                    model_id=model.id,
                    channel_id=channel.id,
                    channel_model_id=channel_model_id,
                    priority=priority,
                )
                session.add(mapping)

    await engine.dispose()
    logger.info("Seed completed: %d channels, %d models, %d mappings",
                len(CHANNELS_SEED), len(MODELS_SEED), len(MAPPINGS_SEED))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(seed_database())
