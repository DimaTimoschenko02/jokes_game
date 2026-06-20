---
name: zombie-session-bug
description: "Bug: после рестарта API клиент с активной комнатой в localStorage висит в loading state. Reconnect_failed не чистит session — нужен auto-clear + redirect на главную."
metadata:
  node_type: memory
  type: project
  originSessionId: b711b77b-838b-4db8-a634-bce03b5fbfc4
---

# Zombie session после рестарта API

## Симптом

Юзер был в активной комнате на момент `pm2 restart punchme-api`. После перезагрузки страницы (или просто при reconnect socket) — UI висит в loading state навечно. Кнопка «Начать игру» крутится, lobby показывает старый закешированный state, но на бэке создаётся **ноль** WebSocket-событий. Hard refresh (Ctrl+Shift+R) **не лечит** — потому что проблема в localStorage, а не в кеше браузера. Лечит только `localStorage.clear()` или ручное удаление `punchme-session`.

Юзеры с тестовыми аккаунтами, не находившимися в активной комнате на момент рестарта, не залипали — у них в localStorage не было `roomCode`.

Зафиксировано 2026-05-15 после `pm2 restart` для очистки in-memory комнат HXJJR/TJS3H.

## Корень в коде

`web/src/hooks/use-game-client.ts`:
- Строки 15-31: `SESSION_KEY = 'punchme-session'`, хранит `{ roomCode, playerId }`.
- Строка 50: `useState<PlayerSession | null>(parseStoredSession)` — фронт сразу хватает session из localStorage при маунте.
- Строка 76: передаёт session в `GameSocket` → сокет шлёт reconnect к этой комнате.
- Строка 73: `onError: (message) => setErrorMessage(message)` — на любую ошибку (включая `Room not found`) **просто пишет в errorMessage**. Не чистит session, не чистит localStorage, не редиректит.

В результате UI показывает старый `gameState` (последний полученный) + `errorMessage` (если где-то рендерится), но логика осталась на «я в комнате, жду».

## Why

Это не Claude-related грабли, а UX bug на клиенте. Усугубляется тем что бэк держит комнаты **только в памяти** — любой рестарт API убивает все комнаты, и каждая активная клиентская сессия превращается в зомби. На локалке проявляется реже потому что рестартов меньше; на проде через `pm2 restart` или через deploy.sh — каждый раз.

## How to apply

### Fix (минимальный)

В `web/src/hooks/use-game-client.ts`, в callback `onError`:

```ts
onError: (message) => {
  if (message === 'Room not found' || /* reconnect-related error */) {
    // Зомби-сессия: бэк не знает нашу комнату → выкидываем юзера на главную
    window.localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setGameState(null)
    setErrorMessage('Соединение с комнатой потеряно')
    return
  }
  setErrorMessage(message)
}
```

Зависит от того что именно шлёт бэк при `reconnect_failed` — нужно глянуть `GameGateway` на server side (см. `api/src/modules/game/game.gateway.ts` ws_emit на reconnect failed) и совпадает ли строка ошибки. Если нет — добавить отдельный error code `ROOM_NOT_FOUND` который фронт умеет ловить.

### Альтернатива / связанные шаги

- На клиенте: при auth re-init использовать `requestSession` ack-pattern — сокет запрашивает у бэка «жива ли моя session», бэк отвечает yes/no. На no → clear localStorage.
- Сервер мог бы держать комнаты в **БД** или Redis, тогда рестарт API не убивал бы их — но это бóльшая работа и она блокирует [[host-exit-cancels-game]] (отмена комнаты при выходе хоста). Пока приоритет — на фикс клиента.

## Related

- [[host-exit-cancels-game]] — связанный TODO: если хост уходит до финала → cancel room. Оба касаются жизненного цикла комнаты и устойчивости клиента к нештатным состояниям.
- [[error-text-in-db-bug]] — третий TODO в очереди про robustness pipeline.
- [[prod-server-monitoring]] — `pm2 restart punchme-api` это та операция которая триггерит этот bug.
