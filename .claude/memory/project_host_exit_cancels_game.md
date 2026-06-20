---
name: host-exit-cancels-game
description: "Spec/TODO: если хост покидает комнату до финального scoreboard — игра + все фоновые генерации останавливаются. Если после — всё ок, никого не трогаем."
metadata:
  node_type: memory
  type: project
  originSessionId: b711b77b-838b-4db8-a634-bce03b5fbfc4
---

# Host exit cancels game

## Spec

- **Хост выходит из комнаты ДО того, как все раунды завершились** (т.е. до финального scoreboard последнего раунда) → **остановить всё:**
  - Все фоновые генерации в этой комнате (opening-generator prefetch, bot punchline tasks, memory-updater)
  - Все таймеры комнаты (writing/voting/rating phase)
  - Освободить in-memory state комнаты (или пометить как `cancelled`)
  - Уведомить остальных игроков: «Хост вышел, игра отменена»
- **Хост выходит ПОСЛЕ финального scoreboard** → ничего не делаем. Финальный экран остаётся виден остальным, ratings/joke_memory уже сохранены.

## Why

2026-05-15: после auth-fall комната HXJJR продолжала ходить по фолбэкам, генерации в фоне жгли ресурсы, а живой игры там по факту уже не было. Юзер запросил рестарт API чтобы «остановить всё». Если бы был механизм host-exit → cancel → этого делать не пришлось бы, плюс корректное UX-сообщение остальным игрокам.

Сейчас (до фикса) host disconnect не отменяет комнату — она дрейфует пока не истекут таймеры или пока не сделать `pm2 restart`.

## How to apply

При реализации:
1. На `GameGateway` handler для `handleDisconnect` — если уходящий сокет это хост И `room.phase !== 'scoreboard-final'` → trigger `cancelRoom(roomCode)`.
2. `cancelRoom`:
   - Clear все таймеры (writing/voting/rating timeouts)
   - Abort pending agent sessions (opening-generator, memory-updater) — нужен AbortController на агент-раннере, либо просто пометить session как `cancelled` чтобы `agent_invoke_ok` ничего не делал
   - Уведомить всех клиентов в комнате: emit `game:cancelled` с reason
   - Удалить комнату из in-memory map
3. Определение «финальный scoreboard» — есть ли явный флаг или это последний раунд + phase===scoreboard. Скорее всего нужен `isFinalScoreboard: boolean` в room state, выставляется когда `round === totalRounds && phase === 'scoreboard'`.
4. Бот-агенты которые уже в полёте — их CLI процесс не убить мгновенно (это external child process), но **результат игнорировать** если room уже cancelled.

## Related

- [[v2-status]] — общий статус
- [[error-text-in-db-bug]] — отдельный bug: тексты ошибок попадают в БД. Если оба фиксить вместе — оба касаются устойчивости агентского pipeline.
