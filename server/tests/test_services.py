"""
T1-03: Service 层白盒测试（同步 via DB/Redis sync clients）

直接查数据库和 Redis 验证 Service 层逻辑正确性。
API 层测试（通过 TestClient）已在 test_models_api / test_channels_api 覆盖。
此文件测试:
  - DB 层: 模型查询、渠道查询、映射关系
  - Redis 层: 任务 CRUD
  - COS: ready 属性

Count 断言从 seed 动态计算。
"""
from app.db.seed import MODELS_SEED, MAPPINGS_SEED, CHANNELS_SEED
from app.services.cos_service import cos_service
from app.services.task_service import TASK_KEY_PREFIX

_VIDEO_SEED = [m for m in MODELS_SEED if m["capability"] == "video"]


class TestModelServiceViaDB:
    """通过 sync DB 直接验证 model 数据"""

    def test_list_all(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM ai_models WHERE deleted_at IS NULL AND is_enabled = 1")
        assert cur.fetchone()["cnt"] == len(MODELS_SEED)

    def test_list_by_capability(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM ai_models WHERE capability = 'video' AND deleted_at IS NULL AND is_enabled = 1")
        assert cur.fetchone()["cnt"] == len(_VIDEO_SEED)

    def test_get_model(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("SELECT * FROM ai_models WHERE model_id = 'gpt-5.4'")
        m = cur.fetchone()
        assert m is not None
        assert m["provider"] == "OpenAI"
        assert m["capability"] == "text"

    def test_get_nonexistent(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("SELECT * FROM ai_models WHERE model_id = 'nonexistent'")
        assert cur.fetchone() is None


class TestChannelServiceViaDB:

    def test_list_channels(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM ai_channels WHERE deleted_at IS NULL AND is_enabled = 1")
        assert cur.fetchone()["cnt"] == len(CHANNELS_SEED)

    def test_get_channel(self, db_sync):
        # apimart 在 2026-05 toapis 接入后被重命名为 toapis
        cur = db_sync.cursor()
        cur.execute("SELECT * FROM ai_channels WHERE channel_id = 'toapis'")
        ch = cur.fetchone()
        assert ch is not None
        assert ch["adapter_type"] == "toapis"

    def test_channels_for_image_model(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("""
            SELECT c.channel_id, cm.channel_model_id
            FROM channel_model_mappings cm
            JOIN ai_models m ON cm.model_id = m.id
            JOIN ai_channels c ON cm.channel_id = c.id
            WHERE m.model_id = 'gemini-3.1-flash-image-preview'
            ORDER BY cm.priority
        """)
        rows = cur.fetchall()
        assert len(rows) >= 1
        assert rows[0]["channel_id"] == "yunwu"

    def test_channels_for_video_multiroute(self, db_sync):
        """验证某个视频模型仍保有多渠道路由能力（具体路由定义看 MAPPINGS_SEED）。"""
        # 在 seed 中找一个拥有 >= 2 个 channel mapping 的 video model
        from collections import Counter
        video_ids = {m["model_id"] for m in _VIDEO_SEED}
        counts = Counter(mid for mid, _, _, _ in MAPPINGS_SEED if mid in video_ids)
        multi_route = [mid for mid, n in counts.items() if n >= 2]
        assert multi_route, "至少一个视频模型应保有多渠道冗余"
        target = multi_route[0]
        expected = sorted({ch for mid, ch, _, _ in MAPPINGS_SEED if mid == target})
        cur = db_sync.cursor()
        cur.execute("""
            SELECT c.channel_id, cm.priority
            FROM channel_model_mappings cm
            JOIN ai_models m ON cm.model_id = m.id
            JOIN ai_channels c ON cm.channel_id = c.id
            WHERE m.model_id = %s
            ORDER BY cm.priority
        """, (target,))
        rows = cur.fetchall()
        actual = sorted({r["channel_id"] for r in rows})
        assert actual == expected, f"{target}: DB {actual} != seed {expected}"
        priorities = [r["priority"] for r in rows]
        assert priorities == sorted(priorities)


class TestTaskServiceViaRedis:

    def test_register_and_get(self, redis_sync):
        key = f"{TASK_KEY_PREFIX}__test_task_001__"
        redis_sync.delete(key)
        redis_sync.hset(key, mapping={
            "task_id": "__test_task_001__",
            "model_id": "veo3.1-fast",
            "channel_id": "apimart",
            "channel_model_id": "veo3.1-fast",
            "status": "pending",
        })
        redis_sync.expire(key, 60)
        task = redis_sync.hgetall(key)
        assert task["task_id"] == "__test_task_001__"
        assert task["status"] == "pending"
        redis_sync.delete(key)

    def test_update_task(self, redis_sync):
        key = f"{TASK_KEY_PREFIX}__test_task_002__"
        redis_sync.delete(key)
        redis_sync.hset(key, mapping={
            "task_id": "__test_task_002__",
            "model_id": "veo3.1",
            "channel_id": "puyo",
            "status": "pending",
        })
        redis_sync.hset(key, mapping={"status": "completed", "output_url": "https://video.mp4"})
        task = redis_sync.hgetall(key)
        assert task["status"] == "completed"
        assert task["output_url"] == "https://video.mp4"
        redis_sync.delete(key)

    def test_delete_task(self, redis_sync):
        key = f"{TASK_KEY_PREFIX}__test_task_003__"
        redis_sync.hset(key, mapping={"task_id": "__test_task_003__", "status": "pending"})
        redis_sync.delete(key)
        assert redis_sync.hgetall(key) == {}

    def test_get_nonexistent(self, redis_sync):
        assert redis_sync.hgetall(f"{TASK_KEY_PREFIX}__nonexistent__") == {}


class TestCOSService:

    def test_cos_ready(self):
        """COS should be ready if settings have credentials"""
        assert cos_service.ready is True
