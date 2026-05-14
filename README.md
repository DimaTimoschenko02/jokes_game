# PunchMe

Browser party game. Players + AI bots receive unfinished jokes and write punchlines. Duels, voting, ratings, persistent user memory.

## Stack

| Layer | Tech |
|-------|------|
| Backend | NestJS 11, Socket.IO, Drizzle ORM, Zod, class-validator, JWT |
| Frontend | React 19, Vite 8, Socket.IO client |
| AI (jokes/memory) | Claude CLI agents with persistent sessions (model: sonnet, effort: low) |
| AI (embeddings) | Ollama + BGE-M3 (used for few-shot retrieval from joke memory) |
| Database | PostgreSQL 17 + pgvector extension |
| Runtime | Node.js 20 |
| Infra | Docker Compose |

## Architecture

```
api/src/modules/
├── game/            WebSocket gateway + service: rooms, rounds, duels, voting, ratings, bot orchestration
├── agents/          Three Claude agents: bot, opening-generator, memory-updater
├── claude-agent/    Runner for Claude CLI with persistent sessions and isolated HOME sandbox
├── ai/              Legacy direct Claude CLI calls (fallback path when agent invocations fail)
├── prompt-starter/  PG-backed joke openings, golden openings, feedback loop
├── joke-memory/     Joke storage, quality scoring, few-shot retrieval (BGE-M3 similarity + MMR diversity)
├── embedding/       Text embeddings via Ollama (BGE-M3, 1024-dim, HNSW indexes in pgvector)
├── user/            Player profiles, AI memory snapshots, roles (admin/user)
├── auth/            JWT auth (login/register, bcrypt)
└── admin/           Admin CRUD for prompts/jokes, list/filter/sort/search/pagination

web/src/
├── App.tsx          Main UI for all game phases
├── auth/            Login/register screens, JWT storage
├── admin/           Admin panel UI (prompts + jokes editing)
├── hooks/           Game state, session, socket actions
└── socket/          Socket.IO client wrapper
```

## Prerequisites

- **Node.js 20+**
- **Docker & Docker Compose** (PostgreSQL + Ollama)
- **Claude CLI** — installed, authenticated, in `PATH`
  - `npm install -g @anthropic-ai/claude-code`
  - `claude /login` — uses Anthropic Max OAuth (no API key needed)
  - After login the API spawns the CLI with an isolated `$TEMP/punchme-claude-home` HOME and copies `~/.claude/.credentials.json` + `~/.claude/settings.json` into it. **Without these two files agents will not work** (isolation prevents global `~/.claude/CLAUDE.md` from leaking into agent context).

## Local Development

```bash
# 1. Install deps
cd api && npm install && cd ../web && npm install && cd ..

# 2. First-time only: pull BGE-M3 embedding model
npm run setup

# 3. Start everything (infra + API + Web)
npm run dev
```

API on `http://localhost:4000`, Web on `http://localhost:5173`.

Drizzle migrations are applied automatically at API boot (`api/drizzle/*.sql`).
The seed pack of 148 openings is loaded if the table is empty.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Infra + API + Web (all-in-one) |
| `npm run dev:api` | API only |
| `npm run dev:web` | Web only |
| `npm run infra` | Start PostgreSQL + Ollama containers |
| `npm run infra:stop` | Stop all Docker containers |
| `npm run setup` | Pull BGE-M3 model into Ollama |
| `npm run docker` | Build & start full prod stack (api + web + infra) |
| `npm run docker:tunnel` | Same + ngrok tunnel |
| `npm run docker:down` | Stop production stack |

Drizzle helpers (run inside `api/`):

| Command | Description |
|---------|-------------|
| `npm run db:generate` | Generate migration SQL after schema changes |
| `npm run db:studio` | Open Drizzle Studio (DB inspector) |
| `npm run import:seeds` | Insert curated openings (4 with admin scores) + 7 reference jokes with embeddings via Ollama. Idempotent — safe to re-run. |
| `npm run backfill:embeddings` | Compute embeddings for joke_memory rows where `prompt_embedding IS NULL`. Run after `import:seeds` or after Ollama becomes available. |

## Production Deployment

### Option A: Docker Compose (recommended)

```bash
npm run docker
```

Builds and starts: `api`, `web`, `postgres` (with pgvector), `ollama`.

With ngrok tunnel (requires `NGROK_AUTHTOKEN` env var):

```bash
NGROK_AUTHTOKEN=your_token npm run docker:tunnel
```

**Important for the Docker prod profile:** the `api` container needs Claude CLI installed inside the image. Current `api/Dockerfile` does NOT bundle the CLI — for VPS deployment add `RUN npm install -g @anthropic-ai/claude-code` and mount the auth files (or run `claude /login` interactively from inside the container once and persist `~/.claude` as a volume).

### Option B: Manual deployment on a server

#### 1. PostgreSQL with pgvector

Use the `pgvector/pgvector:pg17` Docker image or install the extension manually on a PG 16+ instance.

```bash
docker run -d --name punchme-pg \
  -e POSTGRES_USER=punchme -e POSTGRES_PASSWORD=punchme -e POSTGRES_DB=punchme \
  -p 5432:5432 -v punchme-pg-data:/var/lib/postgresql/data \
  pgvector/pgvector:pg17
```

Set the connection string:

```bash
export DATABASE_URL="postgres://punchme:punchme@your-host:5432/punchme"
```

Drizzle migrations are applied automatically on API start — no manual `migrate` step needed.

#### 2. Ollama (for embeddings)

Optional but recommended — without it BGE-M3 embeddings are skipped and few-shot retrieval falls back to recency-only.

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull bge-m3

# Or Docker
docker run -d -p 11434:11434 -v ollama-data:/root/.ollama ollama/ollama
docker exec <container> ollama pull bge-m3
```

```bash
export OLLAMA_BASE_URL="http://ollama-host:11434"
```

#### 3. Claude CLI

Must be installed on the API host. The API spawns `claude` as a child process for every agent invocation.

```bash
npm install -g @anthropic-ai/claude-code
claude /login   # Anthropic Max OAuth
```

After login verify these files exist:

```
~/.claude/.credentials.json
~/.claude/settings.json
```

The API copies them into `$TEMP/punchme-claude-home/.claude/` on first spawn to isolate from the global `~/.claude/CLAUDE.md`.

**This is the critical dependency.** Without an authenticated Claude CLI joke generation falls back to seed openings from DB and bot punchlines fail to fallback markers.

#### 4. API

```bash
cd api
npm install
npm run build
DATABASE_URL=postgres://... \
JWT_SECRET=long-random-string \
OLLAMA_BASE_URL=http://localhost:11434 \
PORT=4000 \
node dist/main.js
```

#### 4a. First-time DB bootstrap

Drizzle applies migrations automatically on every API boot. On a fresh DB this
gives you:
- All schema (`prompt_starters`, `joke_memory`, `users`, etc.)
- 4 curated admin-scored openings + 7 reference jokes (migration `0005`)
- Same openings flagged `is_fallback = true` (migration `0006`) so the game has
  something to serve when the agent times out

Embeddings in those rows start as `NULL`. To enable few-shot similarity search:

```bash
# Verify Ollama is up and BGE-M3 is pulled
curl http://localhost:11434/api/tags | grep bge-m3

# Re-import seeds with embeddings (idempotent — UPSERT)
cd api && npm run import:seeds

# Backfill any joke_memory rows that still lack embeddings
npm run backfill:embeddings
```

To add more openings without a code change: use the admin panel
(`/admin` → Prompts tab → "+ Создать опенинг"). Tick **Golden** for it to
appear as a few-shot example in the opening-generator prompt; tick
**Fallback** to add it to the pool used when the AI generator fails.

#### 5. Web

```bash
cd web
npm install
npm run build
# Serve web/dist/ via any static server
npm run preview -- --host 0.0.0.0 --port 5173
```

Or with nginx/Caddy. WebSocket proxy for `/socket.io` is required:

```nginx
location /socket.io {
    proxy_pass http://localhost:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

location /api {
    proxy_pass http://localhost:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}

location / {
    root /path/to/web/dist;
    try_files $uri $uri/ /index.html;
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | API server port |
| `DATABASE_URL` | `postgres://punchme:punchme@localhost:5433/punchme` | PostgreSQL connection string (must support pgvector) |
| `JWT_SECRET` | `punchme-dev-secret-change-me` | **MUST be overridden in production** — JWT signing key |
| `JWT_EXPIRES_IN` | `30d` | JWT token lifetime |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama API URL (embeddings) |
| `OLLAMA_EMBED_MODEL` | `bge-m3` | Ollama embedding model name |
| `CLAUDE_MODEL` | `sonnet` | Legacy fallback path model (agent configs are hard-coded in `api/src/modules/agents/configs/`) |
| `CLAUDE_EFFORT` | `high` | Legacy fallback effort (agents pass `--effort low` explicitly via config) |
| `FINETUNE_EXPORT_DIR` | `tmp/finetune` | Where joke-memory fine-tune exports land |
| `MODEL_VERSION_FILE` | `tmp/model-versions.json` | Tracker file for finetune versions |
| `VITE_SOCKET_PROXY_TARGET` | `http://localhost:4000` | API URL for Vite dev proxy |
| `NGROK_AUTHTOKEN` | — | ngrok auth token (tunnel profile only) |

### Health Check

- API started: `Nest application successfully started` in logs
- Drizzle migrations: `Drizzle migration applied` lines (or `seed_skip existing_count=N`)
- Claude CLI authenticated: `isolated_home_ready dir=... auth_files=2` on first agent spawn — **if `auth_files=0` the credentials weren't found**, agents will fail
- Ollama reachable: no `ollama_embed error` warnings in logs
- Successful agent invocations: `agent_invoke_ok agent=opening-generator|bot|memory-updater`

### Admin Access

User `dimon` is auto-promoted to `admin` role on first boot (migration `0004_user_role.sql`). Other users default to `user`. Admin features:

- `/admin` panel: CRUD on openings + jokes (search, filters, sort, pagination, inline score 1–10, comments, golden toggle)
- Test rooms: in lobby, admin can tick "Test room" — no DB writes (joke memory, openings feedback, golden eval, user memory updates all skipped)

To promote another user, run the SQL manually:
```sql
UPDATE users SET role = 'admin' WHERE LOWER(login) = 'somelogin';
```

### Ports

| Service | Port |
|---------|------|
| API (HTTP + WebSocket) | 4000 |
| Web | 5173 |
| PostgreSQL | 5433 (host) → 5432 (container) |
| Ollama | 11434 |
| ngrok inspector | 4040 |
