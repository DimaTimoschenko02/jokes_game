---
name: prod-server-monitoring
description: "Подключение и мониторинг prod-сервера punchme на bestsrv (SSH, PM2 под qwe, логи Claude-агентов, БД punchme-postgres, deploy.sh через GitHub Actions)."
metadata: 
  node_type: memory
  type: reference
  originSessionId: b711b77b-838b-4db8-a634-bce03b5fbfc4
---

# punchme prod на bestsrv

Применять когда нужно проверить логи / статус / БД prod-сервера, или мониторить вживую пока пользователь играет через https://punchme.oldgod.online.

## Доступ

- **SSH:** `ssh qwe@v2202604348482446949.bestsrv.de` (ключ настроен)
- **PM2** — под `qwe` через nvm. Перед любой `pm2`-командой: `source ~/.nvm/nvm.sh`
- **Логи PM2:** `/home/qwe/.pm2/logs/punchme-api-out.log` и `…-error.log`
- **App path:** `/home/qwe/apps/punchme`, API port: `127.0.0.1:4002`
- **Postgres container:** `punchme-postgres` (127.0.0.1:5432, user/pass/db = `punchme`)
- **Domain:** https://punchme.oldgod.online

## Быстрый снимок состояния

```bash
ssh qwe@v2202604348482446949.bestsrv.de "source ~/.nvm/nvm.sh && pm2 list | grep -E 'punchme-api|name' && docker ps --filter name=punchme --format 'table {{.Names}}\t{{.Status}}' && pm2 logs punchme-api --lines 40 --nostream --raw 2>&1 | tail -40"
```

## Лайв-мониторинг во время теста

Через инструмент **Monitor** (стримит каждую матчнувшую строку как нотификацию). `persistent: true` — работает до `TaskStop`:

```bash
ssh qwe@v2202604348482446949.bestsrv.de "tail -F /home/qwe/.pm2/logs/punchme-api-out.log /home/qwe/.pm2/logs/punchme-api-error.log" | grep --line-buffered -E "agent_invoke_(ok|error)|isolated_home_ready|auth_files=|ollama_embed|ECONNREFUSED|api_listening|db_migrations|Error:|FATAL|Unhandled"
```

## Что искать в логах

**Хорошие сигналы:**
- `Nest application successfully started` / `api_listening port=4002` — API поднялся
- `running_db_migrations` → `db_migrations_complete` — drizzle отработал
- `agent_invoke_ok agent=opening-generator|bot|memory-updater` — Claude CLI агент ответил
- `isolated_home_ready dir=… auth_files=1 auth_mode=env_token` — prod-режим: auth через env-токен (creds-файл НЕ копируется). `auth_files=2 auth_mode=creds_file` — локалка (через креды-файл)
- `generate_round_openings_via_agent` — опенинги сгенерены AI (не DB-fallback)

**Плохие сигналы:**
- `claude_nonzero_exit … "Invalid bearer token"` или `claude_error_response_detected … 401` — env-токен в `.env` невалиден/протух → перегенерить (см. «Claude CLI auth»)
- `bot_answer_fallback` / `generate_round_openings_with_fallback … ai=0 db=N` — AI упал, идёт DB-fallback (боты пишут `[BOT_FALLBACK]`, опенинги из seed)
- `ECONNREFUSED 127.0.0.1:5432` — Postgres лёг или не поднят
- `Can't find meta/_journal.json` — PM2 cwd не на api/ (должен быть `/home/qwe/apps/punchme/api`)
- `ollama_embed error` — Ollama недоступна на :11434 (она шарится с tg-bot-v2)
- `agent_invoke_error` / стектрейс с `claude` в пути

## Состояние БД

```bash
ssh qwe@v2202604348482446949.bestsrv.de "docker exec punchme-postgres psql -U punchme -d punchme -c '\\dt' && docker exec punchme-postgres psql -U punchme -d punchme -c 'SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE prompt_embedding IS NOT NULL) AS with_emb FROM joke_memory;' && docker exec punchme-postgres psql -U punchme -d punchme -c 'SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_golden) AS golden, COUNT(*) FILTER (WHERE is_fallback) AS fallback FROM prompt_starters;'"
```

Сделать админом конкретного юзера:

```bash
ssh qwe@v2202604348482446949.bestsrv.de "docker exec punchme-postgres psql -U punchme -d punchme -c \"UPDATE users SET role='admin' WHERE LOWER(login)='ИМЯ';\""
```

(`dimon` — авто-админ по миграции 0004)

## Деплой

**CI/CD:** push в `main` → GitHub Actions SSH-ит → `/home/qwe/apps/punchme/deploy.sh`. deploy.sh делает:
1. `git pull`
2. `docker compose up` (postgres)
3. wait `pg_isready`
4. `npm ci + build` (api, web)
5. `pm2 delete + start ecosystem.config.cjs`
6. `npm run import:seeds`
7. `npm run backfill:embeddings`

**Принудительный rebuild без правок:** пустой коммит + push.

**Дождаться окончания деплоя** (стабильный API >30с uptime):

```bash
ssh qwe@v2202604348482446949.bestsrv.de 'source ~/.nvm/nvm.sh; for i in $(seq 1 80); do s=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; [print(a[\"pm2_env\"][\"status\"]+\"|\"+str(a[\"pm2_env\"][\"restart_time\"])+\"|\"+str((int(__import__(\"time\").time()*1000)-a[\"pm2_env\"][\"pm_uptime\"])//1000)) for a in json.load(sys.stdin) if a[\"name\"]==\"punchme-api\"]"); echo "[$i] $s"; st=$(echo $s|cut -d"|" -f1); up=$(echo $s|cut -d"|" -f3); [ "$st" = "online" ] && [ "$up" -gt 30 ] && break; sleep 3; done'
```

## Claude CLI auth (env-token) — ВАЖНО

Prod аутентит Claude CLI через **long-lived OAuth-токен в env**, НЕ через креды-файл:

- В `/home/qwe/apps/punchme/.env` лежит `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-…` (1 год жизни, из `claude setup-token`).
- `ecosystem.config.cjs` спредит все `.env` пары в env PM2 → `claude-agent-runner` пробрасывает `...process.env` в спавн → CLI берёт токен.
- **Фикс рецидива «разлогинивается»** (commit 906bbfd): runner раньше копировал `~/.claude/.credentials.json` в изолированный HOME, и **stored creds перебивали env-токен** (приоритет: stored OAuth > env var) → после ротации canonical creds протухали → 401. Теперь в env-token режиме creds-файл **не копируется и удаляется** из персистентного `/tmp/punchme-claude-home` → env-токен единственный auth, throwaway-HOME его не ротирует.
- **Перечитать `.env` после смены токена:** `cd ~/apps/punchme && pm2 restart ecosystem.config.cjs --update-env`. Плоский `pm2 restart punchme-api` НЕ перечитывает `.env` (но сохранённый env переживает деплой/рестарт по имени).
- **Проверить, что токен валиден** (на сервере, без чтения секрета): прямой `claude -p "say PONG" --output-format json` с реальным HOME использует креды-файл (не env-токен). Чтобы проверить именно env-токен — нужен прогон через app (harness) и смотреть `agent_invoke_ok` vs `claude_nonzero_exit … Invalid bearer token`.
- При смене токена в браузерном OAuth логиниться именно под **Max-аккаунтом** (`dim.timoschenko2015@gmail.com`), не под новой регистрацией — иначе токен формально есть, но инференса нет → `Invalid bearer token`.
- Хуки Димы (`block-env-files.sh`, `block-secrets.sh`) блокируют ЛЮБУЮ мою команду, читающую `.env` / `/proc/*/environ` / литерал `.credentials.json` — менять `.env` и читать токен может только Дима сам.

## E2E прогон

`npm run e2e` (Playwright, `e2e/play-smoke.mjs`) — 2 изолированных контекста (host+guest) играют N раундов против prod. Env: `BASE_URL` (деф prod), `ROUNDS` (≥2 — селект только 2/3/4), `BOTS` (1/2), `TEST_ROOM=1` (галка test-room, admin-only → `joke_memory_skip_test_mode`, в базу шутки НЕ пишутся), `HEADED`. Тест-юзеры `e2e_host`/`e2e_guest` (host промоутится в admin ради галки). Между раундами headless-вкладка иногда лагает (3-мин рассинхрон, пустые рейтинги) — флакость харнесса, не прод.

## Конфиг и секреты

- `/home/qwe/apps/punchme/.env` — gitignored, mode 600. `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLAUDE_CODE_OAUTH_TOKEN` (см. «Claude CLI auth»). ecosystem.config.cjs парсит (снимает кавычки) и мёрджит в env PM2.
- `/home/qwe/apps/punchme/ecosystem.config.cjs` — в репе, без секретов. `cwd: api/` (важно для drizzle миграций).
- `/home/qwe/apps/punchme/docker-compose.prod.yml` — только postgres (Ollama шарится с tg-bot-v2).

## НИКОГДА

- Не делать `docker compose -f docker-compose.prod.yml down -v` без явного подтверждения — снесёт Postgres volume.
- Не пушить `.env` или секреты в репу.
- Не использовать `--no-verify` / `--force` для деплой-веток.
- Не трогать Ollama контейнер (его делит tg-bot-v2 — сломаешь не только punchme).

## Важное про CLAUDE.md isolation

На prod-сервере под `qwe` **нет глобального `~/.claude/CLAUDE.md`** — CLAUDE.md leak проблема на проде ИРРЕЛЕВАНТНА. Логика [[claude-md-isolation]] нужна только для локалки dev.

⚠️ **КОРРЕКЦИЯ прежнего вывода:** раньше тут было «на сервере isolated HOME безвредна». Это оказалось НЕВЕРНО — копирование `.credentials.json` в изолированный HOME было **активно вредным на проде**: протухший creds-файл перебивал env-токен (stored creds приоритетнее env var) → постоянные 401 и рецидив «разлогинивается». Пофикшено (см. «Claude CLI auth»): в env-token режиме creds-файл больше не копируется. Изолированный HOME теперь хранит только `settings.json`.

## Related

- [[v2-status]] — что задеплоено
- [[model-quirks]] — почему isolated HOME нужен на dev
