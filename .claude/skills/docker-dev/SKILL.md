---
name: docker-dev
description: Управление Docker Compose стеком проекта (up/down/restart/logs/status/shell/db). Таблицу контейнеров заполнить под свой проект. Триггерить при работе с контейнерами.
disable-model-invocation: true
---

# Docker Dev

Управление Docker Compose стеком проекта. **Таблица контейнеров внизу заполняется под конкретный проект** (имена сервисов/контейнеров/порты из `docker-compose.yaml`).

## Usage

`/docker-dev <command>`:

| Command | Действие |
|---|---|
| `up` | `docker compose up -d --build` |
| `down` | `docker compose down` (НИКОГДА не `-v` без явной просьбы — снесёт volume с данными) |
| `restart` | down + up --build |
| `logs [service]` | `docker compose logs -f --tail 100 [service]` |
| `status` / `ps` | `docker compose ps` + `docker stats --no-stream` |
| `shell <service>` | `docker exec -it <container> bash` |
| `db` | psql внутри postgres-контейнера |

## Execution Rules

- Команды из корня проекта, где лежит `docker-compose.yaml`
- `logs` — всегда с `--tail`, чтобы не залить контекст
- `down -v` запрещён без явной просьбы (дроп volume = потеря БД)
- Не трогать общие/shared контейнеры, от которых зависят другие проекты (напр. общий Ollama, делящийся между ботами)
- НЕ менять `docker-compose.yaml` / `Dockerfile` без явной просьбы
- Команда упала — сначала проверь, запущен ли Docker Desktop

## Container Reference

Инфра (postgres+ollama) всегда; app-контейнеры — под профилем `production`.

| Service | Container | Image | Port | Profile |
|---|---|---|---|---|
| postgres | `punchme-postgres` | `pgvector/pgvector:pg17` | `5433→5432` | — |
| ollama | `punchme-ollama` | `ollama/ollama:latest` | `11434` | — |
| api | `punchme-api` | build `./api` | `4000` | `production` |
| web | `punchme-web` | build `./web` | `5173` | `production` |
| model-pull | `punchme-model-pull` | `curlimages/curl` | — | `setup` (тянет bge-m3) |
| ngrok | `punchme-ngrok` | `ngrok/ngrok` | `4040` | `tunnel` |

- `db` → `docker exec -it punchme-postgres psql -U punchme -d punchme`
- `setup`-профиль однократно тянет модель bge-m3 в ollama.
- **Prod:** punchme делит Ollama с tg-bot-v2 — на сервере НЕ трогать общий ollama-контейнер и не `down -v` (снесёт Postgres volume).
