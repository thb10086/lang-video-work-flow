"""
T1-05: 数据库完整性校验

直接查询数据库验证:
  - 3张新表存在且结构正确
  - 渠道-模型映射关系完整
  - 所有映射的 model_id/channel_id FK 有效
  - 无孤儿映射记录
"""


class TestTableStructure:

    def test_ai_models_columns(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("DESCRIBE ai_models")
        cols = {r["Field"] for r in cur.fetchall()}
        expected = {
            "id", "model_id", "name", "provider", "capability",
            "description", "param_schema", "is_enabled", "sort_order",
            "created_at", "updated_at", "deleted_at",
        }
        assert expected.issubset(cols)

    def test_ai_channels_columns(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("DESCRIBE ai_channels")
        cols = {r["Field"] for r in cur.fetchall()}
        expected = {
            "id", "channel_id", "name", "base_url", "api_key",
            "adapter_type", "is_enabled", "health_status",
            "created_at", "updated_at", "deleted_at",
        }
        assert expected.issubset(cols)

    def test_mappings_columns(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("DESCRIBE channel_model_mappings")
        cols = {r["Field"] for r in cur.fetchall()}
        expected = {
            "id", "model_id", "channel_id", "channel_model_id",
            "priority", "is_enabled", "created_at", "updated_at",
        }
        assert expected.issubset(cols)


class TestMappingIntegrity:

    def test_no_orphan_model_refs(self, db_sync):
        """所有映射的 model_id 都存在于 ai_models"""
        cur = db_sync.cursor()
        cur.execute("""
            SELECT cm.id, cm.model_id
            FROM channel_model_mappings cm
            LEFT JOIN ai_models m ON cm.model_id = m.id
            WHERE m.id IS NULL
        """)
        orphans = cur.fetchall()
        assert len(orphans) == 0, f"Orphan model refs: {orphans}"

    def test_no_orphan_channel_refs(self, db_sync):
        """所有映射的 channel_id 都存在于 ai_channels"""
        cur = db_sync.cursor()
        cur.execute("""
            SELECT cm.id, cm.channel_id
            FROM channel_model_mappings cm
            LEFT JOIN ai_channels c ON cm.channel_id = c.id
            WHERE c.id IS NULL
        """)
        orphans = cur.fetchall()
        assert len(orphans) == 0, f"Orphan channel refs: {orphans}"

    def test_mapping_count(self, db_sync):
        cur = db_sync.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM channel_model_mappings")
        assert cur.fetchone()["cnt"] == 14

    def test_unique_constraint(self, db_sync):
        """同一 model+channel 组合只有一条映射"""
        cur = db_sync.cursor()
        cur.execute("""
            SELECT model_id, channel_id, COUNT(*) as cnt
            FROM channel_model_mappings
            GROUP BY model_id, channel_id
            HAVING cnt > 1
        """)
        dupes = cur.fetchall()
        assert len(dupes) == 0, f"Duplicate mappings: {dupes}"

    def test_video_multi_channel_routing(self, db_sync):
        """veo3.1-fast 应有 2 个渠道映射（apimart + puyo）"""
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

    def test_all_enabled(self, db_sync):
        """种子数据中所有记录都应启用"""
        cur = db_sync.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM ai_models WHERE is_enabled != 1 AND deleted_at IS NULL")
        assert cur.fetchone()["cnt"] == 0

        cur.execute("SELECT COUNT(*) as cnt FROM ai_channels WHERE is_enabled != 1 AND deleted_at IS NULL")
        assert cur.fetchone()["cnt"] == 0

        cur.execute("SELECT COUNT(*) as cnt FROM channel_model_mappings WHERE is_enabled != 1")
        assert cur.fetchone()["cnt"] == 0
