import postgres from 'postgres'

const DATABASE_URL: string =
  process.env.DATABASE_URL ?? 'postgres://punchme:punchme@localhost:5433/punchme'
const OLLAMA_BASE_URL: string = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const OLLAMA_EMBED_MODEL: string = process.env.OLLAMA_EMBED_MODEL ?? 'bge-m3'
const BATCH_SIZE: number = 50
const EMBED_TIMEOUT_MS: number = 15000

type Row = {
  readonly id: string
  readonly prompt: string
  readonly prompt_normalized: string
}

type OllamaResponse = {
  readonly embedding?: readonly number[]
}

async function embedText(text: string): Promise<readonly number[] | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS)
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text })
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error(`ollama http=${response.status} body=${detail.slice(0, 160)}`)
      return null
    }
    const json = (await response.json()) as OllamaResponse
    return json.embedding && json.embedding.length > 0 ? json.embedding : null
  } catch (error) {
    console.error(`ollama error=${error instanceof Error ? error.message : String(error)}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const force: boolean = process.argv.includes('--force')
  console.log(
    `[backfill] db=${DATABASE_URL.replace(/:[^:@]+@/, ':***@')} ollama=${OLLAMA_BASE_URL} model=${OLLAMA_EMBED_MODEL} force=${force}`
  )

  const probe = await embedText('test')
  if (!probe) {
    console.error('[backfill] ollama probe failed — make sure `ollama pull bge-m3` was run and ollama is up')
    process.exit(1)
  }
  console.log(`[backfill] ollama probe ok, vector_dim=${probe.length}`)

  const sql = postgres(DATABASE_URL, { max: 1, prepare: false })
  try {
    const totalRow = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM joke_memory`
    const pendingRow = force
      ? await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM joke_memory`
      : await sql<
          { count: number }[]
        >`SELECT COUNT(*)::int AS count FROM joke_memory WHERE prompt_embedding IS NULL`
    console.log(`[backfill] total=${totalRow[0].count} pending=${pendingRow[0].count}`)

    let processed: number = 0
    let succeeded: number = 0
    let failed: number = 0

    while (true) {
      const rows: Row[] = force
        ? await sql<Row[]>`
            SELECT id, prompt, prompt_normalized
            FROM joke_memory
            ORDER BY created_at ASC
            LIMIT ${BATCH_SIZE}
            OFFSET ${processed}
          `
        : await sql<Row[]>`
            SELECT id, prompt, prompt_normalized
            FROM joke_memory
            WHERE prompt_embedding IS NULL
            ORDER BY created_at ASC
            LIMIT ${BATCH_SIZE}
          `
      if (rows.length === 0) {
        break
      }
      for (const row of rows) {
        const vector = await embedText(row.prompt_normalized || row.prompt)
        if (!vector) {
          failed += 1
          console.warn(`[backfill] skip id=${row.id} prompt="${row.prompt.slice(0, 60)}"`)
          continue
        }
        await sql`
          UPDATE joke_memory
          SET prompt_embedding = ${JSON.stringify(vector)}::vector,
              embedding_model = ${OLLAMA_EMBED_MODEL}
          WHERE id = ${row.id}
        `
        succeeded += 1
        if (succeeded % 10 === 0) {
          console.log(`[backfill] progress succeeded=${succeeded} failed=${failed}`)
        }
      }
      processed += rows.length
      if (force && processed >= totalRow[0].count) {
        break
      }
    }

    console.log(`[backfill] done succeeded=${succeeded} failed=${failed}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error(`[backfill] fatal ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})
