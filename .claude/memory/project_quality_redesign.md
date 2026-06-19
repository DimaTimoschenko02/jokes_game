---
name: V1 Quality Redesign (SUPERSEDED)
description: V1 quality redesign on Mongo+Claude CLI. Superseded by V2 (PG+pgvector, auth, persistent sessions). Kept as historical context — V1 code path lives only as fallback in v2.
type: project
originSessionId: b711b77b-838b-4db8-a634-bce03b5fbfc4
---
## V1 Quality Redesign — Superseded (2026-04-15)

**Status: superseded by V2 (см. `project_v2_redesign.md`).** В коде на `dev_v2` v1-методы (`aiService.generateBotAnswer`, `aiService.generateAllOpenings`, `executeRetrieveExamples`) живут только как fallback пути, дёргаются если соответствующая v2-сессия упала.

**Что было сделано в v1 (для контекста):**
- Two-stage opening generation: generate ×3 → Claude filter (2 stateless вызова)
- Player bios из localStorage textarea
- No name placeholders в шутках
- BGE-M3 embeddings вместо nomic-embed-text
- Golden openings feedback loop
- Multi-candidate bot punchlines (3 → pick best) — в v2 заменено на single-call
- Storage был на Mongo

**Why оставлено в коде:** v2 fallback. Если `BotAgentService`/`OpeningGeneratorAgentService` сессия отвалилась, игра не падает — переключается на старый stateless путь.

**Как удалить когда v2 будет stable:**
- Из `game.service.ts` убрать всё что под `// Legacy fallback`
- Удалить `aiService.generateBotAnswer` + `executeRetrieveExamples` целиком
- Это запланировано но отложено пока v2 не прошла smoke test
