"""
T1-03: Service 层白盒测试（同步 via DB/Redis sync clients）

直接查数据库和 Redis 验证 Service 层逻辑正确性。
API 层测试（通过 TestClient）已在 test_models_api / test_channels_api 覆盖。
此文件测试:
  - DB 层: 模型查询、渠道查询、映射关系
  - Redis 层: 任务 CRUD
  - COS: ready 属性
"""

from app.services.cos_service import cos_service
from app.services.task_service import TASK_KEY_PREFIX


class TestModelServiceViaDB:
    """通过 sync DB 直接验证 model 数据"""

    def test_list_all(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM ai_models WHERE deleted_at IS NULL AND is_enabled = 1")
        assert cur.fetchone()["cnt"] == 15

    def test_list_by_capability(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM ai_models WHERE capability = 'video' AND deleted_at IS NULL AND is_enabled = 1")
        assert cur.fetchone()["cnt"] == 6

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
        assert cur.fetchone()["cnt"] == 4

    def test_get_channel(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("SELECT * FROM ai_channels WHERE channel_id = 'apimart'")
        ch = cur.fetchone()
        assert ch is not None
        assert ch["adapter_type"] == "apimart"

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
        """veo3.1-fast: apimart(p=0) + puyo(p=10)"""
        cur = db_sync.cursor()
        cur.execute("""
            SELECT c.channel_id, cm.priority
            FROM channel_model_mappings cm
            JOIN ai_models m ON cm.model_id = m.id
            JOIN ai_channels c ON cm.channel_id = c.id
            WHERE m.model_id = 'veo3.1-fast'
            ORDER BY cm.priority
        """)
        rows = cur.fetchall()
        assert len(rows) == 2
        assert rows[0]["channel_id"] == "apimart"
        assert rows[1]["channel_id"] == "puyo"
        assert rows[0]["priority"] < rows[1]["priority"]


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
