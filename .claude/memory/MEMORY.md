# Memory Index

- [V2 Status](project_v2_status.md) — ветка `dev` = group memory (D) + voting-scoring (E), не смержена (гейт — ручной плейтест). Дальше: C memory-updater портрет юзера. ЧИТАТЬ ПЕРВЫМ.
- [Bug: error text in DB](project_error_text_in_db_bug.md) — FIXED на ветке feat/group-memory (валидация AI output). Тексты ошибок Claude CLI больше не сохраняются как шутки/опенинги.
- [Host exit cancels game](project_host_exit_cancels_game.md) — FIXED на ветке feat/group-memory: хост ушёл до финала → отмена комнаты + стоп генераций; после финала → ничего.
- [Zombie session bug](project_zombie_session_bug.md) — FIXED на ветке feat/group-memory: auto-clear localStorage + redirect на главную при Room not found.
- [Prod Server Monitoring](project_prod_server.md) — SSH/PM2/логи/БД на bestsrv (punchme.oldgod.online). Команды для лайв-мониторинга через Monitor tool, deploy.sh pipeline.
- [Model Quirks](project_model_quirks.md) — реальные грабли Claude CLI и моделей которые ловили в production (cross-spawn, CLAUDE.md leak, retry, CoT, short field names, ValidationPipe silent drop).
- [Audience Context](project_audience_context.md) — игроки 22-25 лет, Украина, 2026 (война, FPV, ВСУ — родной контекст). Применять к ЛЮБОМУ LLM промпту в проекте.
- [V2 Redesign Initial](project_v2_redesign.md) — изначальный план dev_v2 (PG+pgvector, JWT auth, persistent Claude sessions). Архитектурные референсы. Снимок начала редизайна, не финальный.
- [V1 Quality Redesign (SUPERSEDED)](project_quality_redesign.md) — старый v1 на Mongo, fallback path в v2. Историческая справка.
