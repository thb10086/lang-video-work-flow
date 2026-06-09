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
        "channel_id": "toapis",
        "name": "ToApis (聚合网关)",
        "base_url": settings.CHANNEL_TOAPIS_URL,
        "api_key": settings.CHANNEL_TOAPIS_KEY,
        "adapter_type": "toapis",
        "config_json": {"timeout": 600, "max_concurrent": 3, "description": "OpenAI 兼容聚合网关，image+video 统一异步任务"},
    },
]

# ════════════════════════════════════════════════════════════════
# 2. 模型种子数据
# ════════════════════════════════════════════════════════════════

MODELS_SEED = [
    # ── 图片模型 ──
    {
        "model_id": "gpt-image-2",
        "name": "GPT Image 2",
        "provider": "OpenAI",
        "capability": "image",
        "description": "OpenAI GPT-Image-2，高质量图片生成，支持文生图 / 参考图引导，默认图片模型",
        "sort_order": 0,
        "param_schema": [
            {"key": "size", "label": "尺寸", "type": "select", "required": False, "default": "1024x1024",
             "options": [
                 {"label": "1024×1024 (1:1)", "value": "1024x1024"},
                 {"label": "1792×1024 (16:9)", "value": "1792x1024"},
                 {"label": "1024×1792 (9:16)", "value": "1024x1792"},
                 {"label": "1280×1024 (4:3)", "value": "1280x1024"},
                 {"label": "1024×1280 (3:4)", "value": "1024x1280"},
             ]},
            {"key": "resolution", "label": "清晰度", "type": "select", "required": False, "default": "1024",
             "options": [
                 {"label": "1024 标准", "value": "1024"},
                 {"label": "1536 高清", "value": "1536"},
                 {"label": "2048 超清", "value": "2048"},
             ]},
            {"key": "response_format", "label": "返回格式", "type": "select", "required": False, "default": "url",
             "options": [
                 {"label": "URL", "value": "url"},
                 {"label": "Base64", "value": "b64_json"},
             ]},
        ],
    },
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
        "model_id": "claude-opus-4-7",
        "name": "Claude Opus 4",
        "provider": "Anthropic",
        "capability": "text",
        "description": "Anthropic 旗舰模型，最强推理与工具调用能力",
        "sort_order": 35,
        "param_schema": [
            {"key": "temperature", "label": "温度", "type": "slider", "required": False, "default": 0.3, "min": 0, "max": 1, "step": 0.1},
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
    # 注：veo3.1（=toapis veo3.1-quality）已移除——价格高，按用户要求禁用，
    # 改为更便宜的 veo3.1-lite 替代
    {
        "model_id": "sora-2-vvip",
        "name": "Sora 2 VVIP (默认)",
        "provider": "OpenAI",
        "capability": "video",
        "description": "OpenAI Sora 2 VVIP — toapis 30 积分/次（按次计费），1080p HD，i2v/r2v 一致性最好。⚠️ 实测 svip 分组下仅 duration=12 有定价规则",
        "sort_order": 5,
        "param_schema": [
            # toapis sora-2-vvip 实测：svip 分组下仅 duration=12 被定价规则接受，
            # 其它 4/5/6/8/10/15/16/20 全部返回 503 pricing rule match failed。
            # 锁定 12s 单选，避免用户/Agent 选了不支持的时长报错。
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 12,
             "options": [{"label": "12秒", "value": 12}]},
            # aspect_ratio + resolution 共同决定 input_reference 必须严格匹配的尺寸
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"}]},
            {"key": "resolution", "label": "分辨率", "type": "select", "required": False, "default": "720p",
             "options": [{"label": "720p (1280x720 / 720x1280)", "value": "720p"},
                         {"label": "1080p (1920x1080 / 1080x1920)", "value": "1080p"}],
             "description": "i2v/r2v 模式下，input_reference 图片必须严格匹配此尺寸（短边像素=数字）"},
            {"key": "style", "label": "风格", "type": "select", "required": False,
             "options": [{"label": "无", "value": ""}, {"label": "动漫", "value": "anime"},
                         {"label": "漫画", "value": "comic"}, {"label": "新闻", "value": "news"},
                         {"label": "自拍", "value": "selfie"}, {"label": "复古", "value": "nostalgic"}]},
            {"key": "seed", "label": "随机种子", "type": "number", "required": False, "placeholder": "留空随机", "description": ">=0 整数，用于结果复现"},
            {"key": "watermark", "label": "水印", "type": "boolean", "required": False, "default": False},
        ],
    },
    {
        "model_id": "sora-2-official",
        "name": "Sora 2 Official",
        "provider": "OpenAI",
        "capability": "video",
        "description": "OpenAI Sora 2 官方版本 — toapis 16 积分/秒（按秒计费），物理一致性最好，但 5s 视频要 80 积分（贵于 vvip 30/次）",
        "sort_order": 6,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 5,
             "options": [{"label": "5秒", "value": 5}, {"label": "10秒", "value": 10}, {"label": "15秒", "value": 15}]},
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"}]},
            {"key": "resolution", "label": "分辨率", "type": "select", "required": False, "default": "720p",
             "options": [{"label": "720p", "value": "720p"}, {"label": "1080p", "value": "1080p"}],
             "description": "i2v 模式下 input_reference 图片必须严格匹配尺寸"},
            {"key": "seed", "label": "随机种子", "type": "number", "required": False, "placeholder": "留空随机"},
            {"key": "watermark", "label": "水印", "type": "boolean", "required": False, "default": False},
        ],
    },
    {
        "model_id": "veo3.1-lite",
        "name": "VEO 3.1 Lite",
        "provider": "Google",
        "capability": "video",
        "description": "Google VEO 3.1 轻量版，性价比最高，按次计费",
        "sort_order": 22,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 8,
             "options": [{"label": "8秒", "value": 8}]},
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"}]},
            {"key": "resolution", "label": "分辨率", "type": "select", "required": False, "default": "720p",
             "options": [{"label": "720p", "value": "720p"}, {"label": "1080p", "value": "1080p"}]},
            {"key": "image_mode", "label": "图片模式", "type": "select", "required": False, "default": "frame",
             "options": [{"label": "首尾帧", "value": "frame"}, {"label": "参考图", "value": "reference"}]},
        ],
    },
    {
        "model_id": "wan2.6-flash",
        "name": "Wan 2.6 Flash",
        "provider": "Alibaba",
        "capability": "video",
        "description": "阿里万相 2.6 Flash — 6 积分/秒，5s 视频仅 30 积分，最低成本兜底",
        "sort_order": 40,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 5,
             "options": [{"label": "5秒", "value": 5}, {"label": "8秒", "value": 8}]},
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"}, {"label": "方形 1:1", "value": "1:1"}]},
            {"key": "resolution", "label": "分辨率", "type": "select", "required": False, "default": "720p",
             "options": [{"label": "480p", "value": "480p"}, {"label": "720p", "value": "720p"}, {"label": "1080p", "value": "1080p"}]},
            {"key": "negative_prompt", "label": "负面提示词", "type": "textarea", "required": False, "default": ""},
        ],
    },
    {
        "model_id": "kling-v2-6",
        "name": "Kling v2.6",
        "provider": "Kuaishou",
        "capability": "video",
        "description": "可灵 v2.6 — 7.36 积分/秒，支持首尾帧+音频，画面稳定性优秀",
        "sort_order": 35,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 5,
             "options": [{"label": "5秒", "value": 5}, {"label": "10秒", "value": 10}]},
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"}, {"label": "方形 1:1", "value": "1:1"}]},
            {"key": "mode", "label": "质量", "type": "select", "required": False, "default": "std",
             "options": [{"label": "标准 (720P)", "value": "std"}, {"label": "专业 (1080P)", "value": "pro"}]},
            {"key": "negative_prompt", "label": "负面提示词", "type": "textarea", "required": False, "default": "", "placeholder": "模糊, 低画质, 变形"},
            {"key": "audio", "label": "生成音频", "type": "boolean", "required": False, "default": False},
        ],
    },
    {
        "model_id": "minimax-hailuo-2-3",
        "name": "MiniMax Hailuo 2.3",
        "provider": "MiniMax",
        "capability": "video",
        "description": "海螺 2.3 — 9.76 积分/秒，运动镜头表现力强，适合人物动作",
        "sort_order": 38,
        "param_schema": [
            {"key": "duration", "label": "时长(秒)", "type": "select", "required": False, "default": 6,
             "options": [{"label": "6秒", "value": 6}, {"label": "10秒", "value": 10}]},
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [{"label": "横屏 16:9", "value": "16:9"}, {"label": "竖屏 9:16", "value": "9:16"}]},
            {"key": "resolution", "label": "分辨率", "type": "select", "required": False, "default": "720p",
             "options": [{"label": "768p", "value": "768p"}, {"label": "1080p", "value": "1080p"}]},
        ],
    },
    {
        "model_id": "grok-video-3",
        "name": "Grok Video 3",
        "provider": "xAI",
        "capability": "video",
        # toapis docs: https://docs.toapis.com/docs/cn/api-reference/videos/grok-video/generation
        # 关键差异（与其他视频模型不同）:
        #   1. 时长字段叫 `seconds`(不是 `duration`), 值是字符串 "6"/"10"/"15"/"20"/"25"/"30"
        #   2. 输入图字段叫 `images`(不是 `image_urls`), 最多 3 张
        # toapis_adapter 已做兼容(同时双写 images + image_urls; seconds 透传白名单)
        "description": "xAI Grok Video 3 - toapis 异步任务, 6/10/15/20/25/30s 文生视频与图生视频, 速度快(实测 6s 视频约 30s 出片)",
        "sort_order": 50,
        "param_schema": [
            {"key": "seconds", "label": "时长(秒)", "type": "select", "required": False, "default": "10",
             "options": [
                 {"label": "6秒", "value": "6"},
                 {"label": "10秒", "value": "10"},
                 {"label": "15秒", "value": "15"},
                 {"label": "20秒", "value": "20"},
                 {"label": "25秒", "value": "25"},
                 {"label": "30秒", "value": "30"},
             ]},
            {"key": "aspect_ratio", "label": "比例", "type": "select", "required": False, "default": "16:9",
             "options": [
                 {"label": "横屏 16:9", "value": "16:9"},
                 {"label": "竖屏 9:16", "value": "9:16"},
                 {"label": "横版 3:2", "value": "3:2"},
                 {"label": "竖版 2:3", "value": "2:3"},
                 {"label": "方形 1:1", "value": "1:1"},
             ]},
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
    # 图片 → toapis（默认，新 gpt-image-2）+ yunwu（Gemini 原生 API 作 fallback 与老模型）
    ("gpt-image-2", "toapis", "gpt-image-2", 0),
    ("gemini-3.1-flash-image-preview", "yunwu", "gemini-3.1-flash-image-preview", 0),
    ("gemini-3-pro-image-preview", "yunwu", "gemini-3-pro-image-preview", 0),

    # LLM → yunwu-llm (OpenAI 兼容)
    ("gemini-3.1-pro-preview", "yunwu-llm", "gemini-3.1-pro-preview", 0),
    ("gpt-5.4", "yunwu-llm", "gpt-5.4", 0),
    ("gpt-4o", "yunwu-llm", "gpt-4o", 0),
    ("claude-opus-4-7", "yunwu-llm", "claude-opus-4-7", 0),
    ("claude-sonnet-4-20250514", "yunwu-llm", "claude-sonnet-4-20250514", 0),

    # ⚠️ ToApis 已确认 SKU 状态（2026-05，按价格排序）：
    #   按次：veo3.1-fast 16/次  /  veo3.1-lite 更便宜  /  sora-2-vvip 30/次  /  sora-2-official
    #   按秒：wan2.6-flash 6/s   /  kling-v2-6 7.36/s   /  hailuo-2.3 9.76/s
    #   按 token：doubao-seedance-2-0(-fast) 1057.14/1M
    # ❌ veo3.1-quality 太贵已禁用（用户决策）；sora-2-vip 已替换为 sora-2-vvip

    # Sora 2 系列（OpenAI） → toapis primary
    ("sora-2-vvip", "toapis", "sora-2-vvip", 0),
    ("sora-2-official", "toapis", "sora-2-official", 0),

    # VEO → toapis primary, puyo fallback
    ("veo3.1-fast", "toapis", "veo3.1-fast", 0),
    ("veo3.1-fast", "puyo", "veo-3-1-fast", 10),
    ("veo3.1-lite", "toapis", "veo3.1-lite", 0),

    # Kling → toapis primary（注意命名：channel_model_id 用 toapis 真实 SKU）
    ("kling-v2-6", "toapis", "kling-v2-6", 0),

    # Wan / Hailuo / Doubao → toapis only
    ("wan2.6-flash", "toapis", "wan2.6-flash", 0),
    ("minimax-hailuo-2-3", "toapis", "minimax-hailuo-2-3", 0),
    ("doubao-seedance-2-0", "toapis", "doubao-seedance-2-0", 0),
    ("doubao-seedance-2-0-fast", "toapis", "doubao-seedance-2-0-fast", 0),

    # Grok Video 3 (xAI) → toapis only
    ("grok-video-3", "toapis", "grok-video-3", 0),
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

            # 插入模型 (schema_version 由 ORM default=1 填充)
            model_map: dict[str, AiModel] = {}
            for m_data in MODELS_SEED:
                m = AiModel(**m_data)
                if getattr(m, "schema_version", None) is None:
                    m.schema_version = 1
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

    # 清 Redis 模型缓存：seed 直接 INSERT 而非走 ModelService CRUD，
    # 不会自动失效缓存；不清的话前端拿到的还是旧列表。
    await _clear_model_cache()


async def _clear_model_cache() -> None:
    """清除 prism:models:* 缓存，使 seed 后的新模型立刻可见。"""
    try:
        import redis.asyncio as aioredis
        from app.services.model_service import CACHE_PREFIX
    except Exception as e:  # 容错：缺依赖时不阻断 seed
        logger.warning("Skip cache clear (import failed): %s", e)
        return

    cli = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        keys: list[str] = []
        async for k in cli.scan_iter(match=f"{CACHE_PREFIX}*", count=200):
            keys.append(k)
        if keys:
            await cli.delete(*keys)
            logger.info("Cleared %d model cache keys: %s", len(keys), keys)
        else:
            logger.info("No model cache keys to clear")
    except Exception as e:
        logger.warning("Cache clear failed: %s", e)
    finally:
        await cli.aclose()


async def _clear_model_cache() -> None:
    """清除 prism:models:* 缓存，使 seed 后的新模型立刻可见。"""
    try:
        import redis.asyncio as aioredis
        from app.services.model_service import CACHE_PREFIX
    except Exception as e:  # 容错：缺依赖时不阻断 seed
        logger.warning("Skip cache clear (import failed): %s", e)
        return

    cli = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        keys: list[str] = []
        async for k in cli.scan_iter(match=f"{CACHE_PREFIX}*", count=200):
            keys.append(k)
        if keys:
            await cli.delete(*keys)
            logger.info("Cleared %d model cache keys: %s", len(keys), keys)
        else:
            logger.info("No model cache keys to clear")
    except Exception as e:
        logger.warning("Cache clear failed: %s", e)
    finally:
        await cli.aclose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(seed_database())
