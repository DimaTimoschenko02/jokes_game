import postgres from 'postgres'

const DATABASE_URL: string =
  process.env.DATABASE_URL ?? 'postgres://punchme:punchme@localhost:5433/punchme'
const OLLAMA_BASE_URL: string = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const OLLAMA_EMBED_MODEL: string = process.env.OLLAMA_EMBED_MODEL ?? 'bge-m3'
const EMBED_TIMEOUT_MS: number = 15000
const SEED_AUTHOR_NAME: string = 'Dima'
const SEED_ROOM_CODE: string = 'SEED'

type SeedPunchline = {
  readonly text: string
  readonly score: number
  readonly comment: string
}

type SeedOpening = {
  readonly text: string
  readonly score: number
  readonly comment: string
  readonly punchlines: readonly SeedPunchline[]
}

const SEEDS: readonly SeedOpening[] = [
  {
    text: 'после четвертой попытки трахнуть пылесос Дима',
    score: 10,
    comment: 'неожиданно, смех над Димой',
    punchlines: [
      {
        text: 'всё-таки вернулся к своей девушке',
        score: 9,
        comment: 'юмор с некой дискриминацией'
      },
      {
        text: 'смог попасть на шоу «тупые с маленькими членами»',
        score: 5,
        comment: 'не современно, всякие шоу уже никто не смотрит, особенно в нашем поколении'
      }
    ]
  },
  {
    text: 'Богдан стал оператором FPV дронов чтобы',
    score: 9,
    comment: 'актуально и забавно в условиях текущей ситуации в Украине',
    punchlines: [
      {
        text: 'подглядывать за русскими малолетками',
        score: 9,
        comment: 'выставление Богдана в роли педофила-маньяка'
      },
      {
        text: 'побеждать в войне',
        score: 5,
        comment: 'это приятно слышать, но это не смешно и банально, предсказуемо'
      }
    ]
  },
  {
    text: 'после застолья не придумав ничего более Олег пошёл заниматься спортом в',
    score: 5,
    comment: 'длинно, урезаны разветвления — лучше было бы закончить на "Олег пошёл", тогда оценка была бы 7-8',
    punchlines: [
      {
        text: 'стрипуху',
        score: 7,
        comment: 'хорошее короткое завершение длинной шутки, но можно было бы добавить абсурда или неожиданности'
      },
      {
        text: 'зал, где уже были его собутыльники',
        score: 3,
        comment: 'а в чём тут шутка вообще?'
      }
    ]
  },
  {
    text: 'после того как колобок повесился, Тася взяла его и',
    score: 4,
    comment: 'про колобка уже старая шутка, всё было бы не так плохо если бы в конце не было ограничения "Тася взяла его и" — очень сужает продолжение и так заезженой шутки',
    punchlines: [
      {
        text: 'продолжила использовать как анальный шарик',
        score: 8,
        comment: 'абсурдно и неожиданно, довольно хорошее продолжение для плохого старта'
      }
    ]
  }
]

type OllamaResponse = {
  readonly embedding?: readonly number[]
}

async function embedText(text: string): Promise<readonly number[]> {
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
      throw new Error(`ollama http=${response.status} body=${detail.slice(0, 160)}`)
    }
    const json = (await response.json()) as OllamaResponse
    if (!json.embedding || json.embedding.length === 0) {
      throw new Error('ollama returned empty embedding')
    }
    return json.embedding
  } finally {
    clearTimeout(timer)
  }
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function buildFingerprint(prompt: string, punchline: string): string {
  return `${prompt.toLowerCase().trim()}::${punchline.toLowerCase().trim()}`
}

function qualityScoreFromAdminScore(adminScore: number): number {
  const normalized: number = Math.min(1, Math.max(0, adminScore / 10))
  return Number(normalized.toFixed(4))
}

function voteShareFromAdminScore(adminScore: number): number {
  return Number(Math.min(1, Math.max(0, adminScore / 10)).toFixed(4))
}

async function main(): Promise<void> {
  console.log(`[seeds] db=${DATABASE_URL.replace(/:[^:@]+@/, ':***@')} ollama=${OLLAMA_BASE_URL}`)
  const probe = await embedText('test').catch((error: Error) => {
    console.error(`[seeds] embedding probe failed: ${error.message}`)
    return null
  })
  if (!probe) {
    process.exit(1)
  }
  console.log(`[seeds] embedding probe ok dim=${probe.length}`)

  const sql = postgres(DATABASE_URL, { max: 1, prepare: false })
  const scoredAt: Date = new Date()
  try {
    let openingsInserted: number = 0
    let openingsUpdated: number = 0
    let jokesInserted: number = 0
    let jokesUpdated: number = 0

    for (const opening of SEEDS) {
      const promptNormalized: string = normalize(opening.text)
      const promptEmbedding: readonly number[] = await embedText(promptNormalized)
      const isGolden: boolean = opening.score >= 8

      const promptStarterResult = await sql<{ id: string; existed: boolean }[]>`
        INSERT INTO prompt_starters (
          text, is_golden, is_seed,
          admin_score, admin_scored_by, admin_scored_at, admin_comment,
          text_embedding, embedding_model
        ) VALUES (
          ${opening.text},
          ${isGolden},
          ${true},
          ${opening.score},
          ${SEED_AUTHOR_NAME},
          ${scoredAt.toISOString()},
          ${opening.comment},
          ${JSON.stringify(promptEmbedding)}::vector,
          ${OLLAMA_EMBED_MODEL}
        )
        ON CONFLICT (text) DO UPDATE SET
          is_golden = EXCLUDED.is_golden,
          is_seed = EXCLUDED.is_seed,
          admin_score = EXCLUDED.admin_score,
          admin_scored_by = EXCLUDED.admin_scored_by,
          admin_scored_at = EXCLUDED.admin_scored_at,
          admin_comment = EXCLUDED.admin_comment,
          text_embedding = EXCLUDED.text_embedding,
          embedding_model = EXCLUDED.embedding_model
        RETURNING id, (xmax = 0) AS existed
      `
      const row = promptStarterResult[0]
      if (row.existed) {
        openingsInserted += 1
      } else {
        openingsUpdated += 1
      }
      console.log(
        `[seeds] opening score=${opening.score} ${row.existed ? 'inserted' : 'updated'} text="${opening.text.slice(0, 50)}..."`
      )

      for (const joke of opening.punchlines) {
        const fingerprint: string = buildFingerprint(promptNormalized, joke.text)
        const quality: number = qualityScoreFromAdminScore(joke.score)
        const voteShare: number = voteShareFromAdminScore(joke.score)

        const jokeResult = await sql<{ id: string; existed: boolean }[]>`
          INSERT INTO joke_memory (
            prompt, punchline, prompt_normalized, fingerprint,
            prompt_embedding, embedding_model,
            quality_score, vote_share,
            admin_score, admin_scored_by, admin_scored_at, admin_comment,
            is_seed,
            author_real_name, source, room_code, round_index
          ) VALUES (
            ${promptNormalized},
            ${joke.text},
            ${promptNormalized.toLowerCase()},
            ${fingerprint},
            ${JSON.stringify(promptEmbedding)}::vector,
            ${OLLAMA_EMBED_MODEL},
            ${quality},
            ${voteShare},
            ${joke.score},
            ${SEED_AUTHOR_NAME},
            ${scoredAt.toISOString()},
            ${joke.comment},
            ${true},
            ${SEED_AUTHOR_NAME},
            ${'human'},
            ${SEED_ROOM_CODE},
            ${0}
          )
          ON CONFLICT (fingerprint) DO UPDATE SET
            prompt_embedding = EXCLUDED.prompt_embedding,
            embedding_model = EXCLUDED.embedding_model,
            quality_score = EXCLUDED.quality_score,
            vote_share = EXCLUDED.vote_share,
            admin_score = EXCLUDED.admin_score,
            admin_scored_by = EXCLUDED.admin_scored_by,
            admin_scored_at = EXCLUDED.admin_scored_at,
            admin_comment = EXCLUDED.admin_comment,
            is_seed = EXCLUDED.is_seed
          RETURNING id, (xmax = 0) AS existed
        `
        const jrow = jokeResult[0]
        if (jrow.existed) {
          jokesInserted += 1
        } else {
          jokesUpdated += 1
        }
        console.log(
          `   ↳ joke score=${joke.score} ${jrow.existed ? 'inserted' : 'updated'} text="${joke.text.slice(0, 50)}..."`
        )
      }
    }

    console.log(
      `[seeds] done openings: +${openingsInserted} / ~${openingsUpdated}, jokes: +${jokesInserted} / ~${jokesUpdated}`
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error(`[seeds] fatal ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})
