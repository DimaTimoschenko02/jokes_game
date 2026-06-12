# Production Server — punchme on bestsrv

Подключение и мониторинг prod-сервера. Применять когда нужно проверить логи / статус / БД prod-сервера, или мониторить вживую пока пользователь играет через https://punchme.oldgod.online.

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
- `isolated_home_ready dir=… auth_files=2` — Claude CLI credentials подхвачены

**Плохие сигналы:**
- `auth_files=0` — Claude credentials не найдены, агенты упадут → проверить `~/.claude/.credentials.json` и `~/.claude/settings.json` под qwe
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

## Конфиг и секреты

- `/home/qwe/apps/punchme/.env` — gitignored, mode 600. `JWT_SECRET`, `JWT_EXPIRES_IN`. ecosystem.config.cjs парсит и мёрджит в env PM2.
- `/home/qwe/apps/punchme/ecosystem.config.cjs` — в репе, без секретов. `cwd: api/` (важно для drizzle миграций).
- `/home/qwe/apps/punchme/docker-compose.prod.yml` — только postgres (Ollama шарится с tg-bot-v2).

## НИКОГДА

- Не делать `docker compose -f docker-compose.prod.yml down -v` без явного подтверждения — снесёт Postgres volume.
- Не пушить `.env` или секреты в репу.
- Не использовать `--no-verify` / `--force` для деплой-веток.
- Не трогать Ollama контейнер (его делит tg-bot-v2 — сломаешь не только punchme).

## CLAUDE.md isolation на проде

На prod-сервере под `qwe` **нет глобального `~/.claude/CLAUDE.md`** — соответственно CLAUDE.md leak проблема на проде ирелевантна. Логика copy-only `.credentials.json` + `settings.json` в `$TEMP/punchme-claude-home` реально нужна только для локалки dev. На сервере она работает no-op.
