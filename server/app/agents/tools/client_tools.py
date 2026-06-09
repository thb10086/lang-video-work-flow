"""Client-scope tool schemas.

These tools have `scope='client'` and `handler=None` — execution happens in
the browser via reverse RPC (see `src/api/clientToolBridge.ts`). The
schemas live here so the LLM gets one consistent tools[] surface
regardless of where the work runs.
"""
from __future__ import annotations

from app.agents.tool_registry import Tool, get_registry


def register() -> None:
    r = get_registry()

    r.register(Tool(
        name="canvas.add_node",
        description="在画布上创建一个新节点。type: 节点类型；data: 节点初始字段；position 可选（不传时由前端自动布局）。",
        parameters={
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "description": "节点类型",
                    "enum": [
                        "characterGrid", "sceneGrid", "imageGen", "videoGen",
                        "textNode", "audioNode", "llmChat", "imageEdit",
                        "characterExtract", "storyboard", "characterManager",
                        "styleLock", "continuityCheck", "videoStitch",
                        "characterAsset", "timeline",
                    ],
                },
                "data": {"type": "object", "description": "节点初始 data 字段（label / prompt 等）"},
                "position": {
                    "type": "object",
                    "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
                },
            },
            "required": ["type"],
        },
        tier="tier2",
        risk_level="low",
        scope="client",
    ))

    r.register(Tool(
        name="canvas.update_node",
        description="修改一个已有节点的部分字段。lock 节点会被拒绝。",
        parameters={
            "type": "object",
            "properties": {
                "node_id": {"type": "string"},
                "patch": {"type": "object"},
            },
            "required": ["node_id", "patch"],
        },
        tier="tier1",
        risk_level="low",
        scope="client",
    ))

    r.register(Tool(
        name="canvas.delete_node",
        description="删除一个节点及其相关连线。force=true 可越过 locked 守卫（需用户审批）。",
        parameters={
            "type": "object",
            "properties": {
                "node_id": {"type": "string"},
                "force": {"type": "boolean", "default": False},
            },
            "required": ["node_id"],
        },
        tier="tier2",
        risk_level="high",  # destructive — triggers approval
        scope="client",
        aliases=("delete_node",),
    ))

    r.register(Tool(
        name="canvas.connect",
        description="按 label 连接两个节点；端口由系统按节点类型自动选择。",
        parameters={
            "type": "object",
            "properties": {
                "source_label": {"type": "string"},
                "target_label": {"type": "string"},
            },
            "required": ["source_label", "target_label"],
        },
        tier="tier1",
        risk_level="low",
        scope="client",
        aliases=("connect_nodes",),
    ))

    r.register(Tool(
        name="canvas.highlight",
        description="在画布上高亮一组节点（用于聊天 hover 互动）。",
        parameters={
            "type": "object",
            "properties": {
                "node_ids": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["node_ids"],
        },
        tier="tier1",
        risk_level="safe",
        scope="client",
    ))

    r.register(Tool(
        name="canvas.undo",
        description="撤销最近一次画布操作。",
        parameters={"type": "object", "properties": {}},
        tier="tier1",
        risk_level="low",
        scope="client",
    ))

    r.register(Tool(
        name="images.collect_user_uploads",
        description="读取用户最近一次消息附带的图片列表（base64 / data URL）。",
        parameters={"type": "object", "properties": {}},
        tier="tier3",
        risk_level="safe",
        scope="client",
    ))

    r.register(Tool(
        name="images.upload_to_cos",
        description="将一张 data-URL 图片上传到对象存储，返回公网 URL。",
        parameters={
            "type": "object",
            "properties": {"data_url": {"type": "string"}},
            "required": ["data_url"],
        },
        tier="tier3",
        risk_level="low",
        scope="client",
    ))

    r.register(Tool(
        name="ui.show_diff",
        description="在客户端展示 before/after diff（用于审批/预览）。",
        parameters={
            "type": "object",
            "properties": {
                "before": {"type": "object"},
                "after": {"type": "object"},
            },
        },
        tier="tier3",
        risk_level="safe",
        scope="client",
    ))

    # ── timeline.create — semantic shortcut that creates a Timeline node
    # and wires it to the supplied upstream video / audio node IDs in one
    # tool call. Equivalent to canvas.add_node + N × canvas.connect, but
    # spares the LLM the orchestration token cost. Implemented as a
    # client-scope tool so the existing canvas mutation primitives can be
    # reused without a new server endpoint.
    r.register(Tool(
        name="timeline.create",
        description=(
            "创建一个时间轴节点并连接给定的视频/音频上游。Returns the new node id."
            " 会自动按上游节点 x 坐标排序生成 cuts JSON。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "label": {"type": "string", "description": "时间轴节点显示名（可选）"},
                "video_node_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "上游视频节点 ID 列表（按时间顺序）",
                },
                "audio_node_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "上游音频节点 ID 列表（可选）",
                },
                "auto_execute": {
                    "type": "boolean",
                    "description": "创建后是否立即触发 executeTimeline",
                    "default": True,
                },
            },
            "required": ["video_node_ids"],
        },
        tier="tier2",
        risk_level="low",
        scope="client",
        aliases=("create_timeline",),
    ))

    # ─────────────────────────────────────────────────────────────────
    # character.* — semantic shortcuts for the unified character node
    # (task 2.4.5). Each tool maps 1:1 to a single mode of the
    # `characterAsset` node introduced in tasks 2.4.1-2.4.4. Backend
    # registers them as **client-scope** because the actual mutation
    # lives in `flowStore.addNode` which only the browser owns; the
    # bridge handler in `src/api/clientToolBridge.ts` delegates the
    # call back into the frontend store.
    #
    # Legacy names (`create_character_grid`, …) stay accepted as
    # aliases — see `tool_registry.resolve()` for the lookup path.
    # When Phase 4 retires the legacy alias surface, the backend
    # registry can simply drop the `aliases=...` tuple here without
    # any handler-side change.
    # ─────────────────────────────────────────────────────────────────
    r.register(Tool(
        name="character.create_grid",
        description=(
            "创建角色九宫图节点（design 模式），用于生成角色多视角参考图。"
            "前置：必须提供 name 与 description（含发色/服装/体型等关键词）。"
            "Returns the new node id."
        ),
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "角色名称"},
                "description": {"type": "string", "description": "角色外貌和特征描述"},
                "style": {
                    "type": "string",
                    "enum": ["anime", "realistic", "cartoon", "watercolor", "pixel art", "comic book", "3D render"],
                    "description": "画风（可选，默认 anime）",
                },
            },
            "required": ["name"],
        },
        tier="tier2",
        risk_level="low",
        scope="client",
        aliases=("create_character_grid",),
    ))

    r.register(Tool(
        name="character.create_extract",
        description=(
            "创建角色提取节点（extract 模式），从视频中抽取角色为可复用的 character ref。"
            "通常连接上游 videoGen，执行时调用 Sora/Seedance 角色提取 API。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "video_url": {"type": "string", "description": "视频 URL（可选，通常由上游 videoGen 注入）"},
                "timestamps": {
                    "type": "string",
                    "description": '采样时间戳（秒，逗号分隔），如 "1,3"；默认 "1,3"',
                },
                "label": {"type": "string", "description": "节点标题（默认\"角色提取\"）"},
            },
            "required": [],
        },
        tier="tier2",
        risk_level="low",
        scope="client",
        aliases=("create_character_extract_node",),
    ))

    r.register(Tool(
        name="character.create_registry",
        description=(
            "创建角色管理器节点（registry 模式），作为画布级的角色库。"
            "下游的 imageGen/videoGen 可用 @角色名 引用其中的角色，"
            "上游可接多个 character.create_grid / create_extract 输出来自动填充。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "label": {"type": "string", "description": "节点标题（默认\"角色管理器\"）"},
            },
            "required": [],
        },
        tier="tier2",
        risk_level="low",
        scope="client",
        aliases=("create_character_manager_node",),
    ))
