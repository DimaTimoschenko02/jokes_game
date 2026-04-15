/**
 * Benchmark script: tests multiple Ollama models for punchline quality & speed.
 * Usage: MODELS="model1,model2" npx tsx test/benchmark-models.ts
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
const MODELS = (process.env.MODELS ?? 'huihui_ai/qwen2.5-abliterate:3b').split(',').map((m) => m.trim())
const TIMEOUT_MS = 120_000

const SYSTEM_PROMPT = [
  'You are a witty player in a humor game.',
  'Output language must be Russian.',
  'You receive an unfinished sentence. Write ONLY the ending/continuation.',
  'Do NOT repeat or rewrite the sentence beginning.',
  'Do NOT prefix with character names, quotes or colons.',
  'Just output the punch line text directly, one line, max 140 chars.'
].join('\n')

const TEST_PROMPTS: { prompt: string; style: string }[] = [
  { prompt: 'Когда я открыл холодильник ночью, он потребовал:', style: 'sarcastic' },
  { prompt: 'На собеседовании я честно сказал, что:', style: 'absurd' },
  { prompt: 'Мой кот посмотрел на меня так, будто:', style: 'dark' },
  { prompt: 'Я попросил ИИ помочь с текстом, и он:', style: 'chaotic' },
  { prompt: 'В такси я сказал "по-быстрому", и водитель:', style: 'bold' },
  { prompt: 'Я пообещал себе начать спортзал, и в тот же день:', style: 'sarcastic' },
]

interface ModelResult {
  model: string
  answers: AnswerResult[]
  avgLatencyMs: number
  maxLatencyMs: number
  minLatencyMs: number
  fallbacks: number
  notRussian: number
  repeatsPrompt: number
  nonsense: number
  qualityScore: number
}

interface AnswerResult {
  prompt: string
  style: string
  answer: string
  latencyMs: number
  isFallback: boolean
  isRussian: boolean
  repeatsPrompt: boolean
  isNonsense: boolean
  tokens: number | null
}

function hasCyrillic(text: string): boolean {
  return /[а-яёА-ЯЁ]/.test(text)
}

function repeatsPromptStart(prompt: string, answer: string): boolean {
  const promptLower = prompt.trim().toLowerCase().replace(/[:\s]+$/, '')
  const answerLower = answer.trim().toLowerCase()
  if (promptLower.length > 15 && answerLower.includes(promptLower)) return true
  const words = promptLower.split(/\s+/)
  if (words.length >= 3 && answerLower.startsWith(words.slice(0, 3).join(' '))) return true
  return false
}

function isNonsenseHeuristic(answer: string): boolean {
  // Very short
  if (answer.length < 5) return true
  // Too many non-Cyrillic chars (>50%)
  const cyrillic = (answer.match(/[а-яёА-ЯЁ]/g) ?? []).length
  const total = answer.replace(/\s/g, '').length
  if (total > 5 && cyrillic / total < 0.5) return true
  // Repeated words
  const words = answer.toLowerCase().split(/\s+/)
  const unique = new Set(words)
  if (words.length > 4 && unique.size < words.length * 0.4) return true
  return false
}

function postProcess(raw: string, prompt: string): string {
  let text = raw.replace(/\s+/g, ' ').trim()
  // Strip wrapping quotes
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('«') && text.endsWith('»'))) {
    text = text.slice(1, -1).trim()
  }
  // Strip "Name: " prefix
  text = text.replace(/^[A-Za-zА-ЯЁа-яё0-9_\s]+:\s*/, (m) => (m.length < 30 ? '' : m))
  // Strip quotes again
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('«') && text.endsWith('»'))) {
    text = text.slice(1, -1).trim()
  }
  // Strip prompt prefix
  const pl = prompt.trim().toLowerCase().replace(/[:\s]+$/, '')
  const tl = text.toLowerCase()
  if (pl.length > 10 && tl.startsWith(pl)) {
    text = text.slice(pl.length).replace(/^[:\s]+/, '').trim()
  }
  return text.slice(0, 140)
}

function buildUserPrompt(prompt: string, style: string): string {
  return [
    `Unfinished sentence: "${prompt}"`,
    `Character style: ${style}`,
    'Write ONLY the continuation/ending of the sentence above.',
    'Do NOT repeat any words from the unfinished sentence.',
  ].join('\n')
}

async function queryModel(model: string, prompt: string, style: string): Promise<AnswerResult> {
  const userMessage = buildUserPrompt(prompt, style)
  const startMs = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        options: { temperature: 1.0, top_p: 0.95, num_predict: 80 }
      })
    })
    const elapsedMs = Date.now() - startMs
    if (!res.ok) {
      return { prompt, style, answer: '', latencyMs: elapsedMs, isFallback: true, isRussian: false, repeatsPrompt: false, isNonsense: true, tokens: null }
    }
    const json = await res.json() as { message?: { content?: string }; eval_count?: number }
    const raw = json.message?.content?.replace(/\s+/g, ' ').trim() ?? ''
    const answer = postProcess(raw, prompt)
    return {
      prompt,
      style,
      answer,
      latencyMs: elapsedMs,
      isFallback: !answer || answer.length < 2,
      isRussian: hasCyrillic(answer),
      repeatsPrompt: repeatsPromptStart(prompt, answer),
      isNonsense: isNonsenseHeuristic(answer),
      tokens: json.eval_count ?? null
    }
  } catch {
    return { prompt, style, answer: '', latencyMs: Date.now() - startMs, isFallback: true, isRussian: false, repeatsPrompt: false, isNonsense: true, tokens: null }
  } finally {
    clearTimeout(timeout)
  }
}

async function benchmarkModel(model: string): Promise<ModelResult> {
  console.log(`\n=== Testing: ${model} ===`)

  // Warm up (first request loads model into memory)
  console.log('  Warming up...')
  await queryModel(model, 'Тестовая фраза для прогрева:', 'sarcastic')

  const answers: AnswerResult[] = []
  for (const { prompt, style } of TEST_PROMPTS) {
    const result = await queryModel(model, prompt, style)
    const flags = [
      result.isFallback ? 'FALLBACK' : null,
      !result.isRussian ? 'NOT_RU' : null,
      result.repeatsPrompt ? 'REPEATS' : null,
      result.isNonsense ? 'NONSENSE' : null,
    ].filter(Boolean)
    console.log(`  [${result.latencyMs}ms] ${flags.length ? `{${flags.join(',')}} ` : ''}prompt="${prompt.slice(0, 40)}..." → "${result.answer}"`)
    answers.push(result)
  }

  const latencies = answers.map((a) => a.latencyMs)
  const fallbacks = answers.filter((a) => a.isFallback).length
  const notRussian = answers.filter((a) => !a.isRussian && !a.isFallback).length
  const repeats = answers.filter((a) => a.repeatsPrompt).length
  const nonsense = answers.filter((a) => a.isNonsense && !a.isFallback).length

  // Quality score: 0-10
  const total = answers.length
  const qualityScore = Math.round(
    ((total - fallbacks) / total) * 3 +            // answers exist: 0-3
    ((total - notRussian) / total) * 2 +            // Russian: 0-2
    ((total - repeats) / total) * 2 +               // no repeats: 0-2
    ((total - nonsense) / total) * 3                // not nonsense: 0-3
  )

  return {
    model,
    answers,
    avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    maxLatencyMs: Math.max(...latencies),
    minLatencyMs: Math.min(...latencies),
    fallbacks,
    notRussian,
    repeatsPrompt: repeats,
    nonsense,
    qualityScore
  }
}

async function main(): Promise<void> {
  console.log(`Ollama: ${OLLAMA_BASE_URL}`)
  console.log(`Models: ${MODELS.join(', ')}`)
  console.log(`Test prompts: ${TEST_PROMPTS.length}`)

  const results: ModelResult[] = []

  for (const model of MODELS) {
    try {
      const result = await benchmarkModel(model)
      results.push(result)
    } catch (error) {
      console.error(`  ERROR testing ${model}: ${error}`)
    }
  }

  // Comparison table
  console.log('\n\n' + '='.repeat(100))
  console.log('MODEL COMPARISON TABLE')
  console.log('='.repeat(100))

  const header = ['Model', 'Avg ms', 'Min ms', 'Max ms', 'Quality', 'Fallback', 'NotRU', 'Repeat', 'Nonsense']
  const rows = results.map((r) => [
    r.model.length > 35 ? r.model.slice(-35) : r.model,
    String(r.avgLatencyMs),
    String(r.minLatencyMs),
    String(r.maxLatencyMs),
    `${r.qualityScore}/10`,
    String(r.fallbacks),
    String(r.notRussian),
    String(r.repeatsPrompt),
    String(r.nonsense)
  ])

  const colWidths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)) + 2)
  const formatRow = (row: string[]): string => row.map((cell, i) => cell.padEnd(colWidths[i])).join('| ')
  console.log(formatRow(header))
  console.log(colWidths.map((w) => '-'.repeat(w)).join('+-'))
  rows.forEach((row) => console.log(formatRow(row)))

  // Detailed answers
  console.log('\n\nDETAILED ANSWERS:')
  for (const r of results) {
    console.log(`\n--- ${r.model} ---`)
    for (const a of r.answers) {
      console.log(`  [${a.latencyMs}ms] "${a.prompt.slice(0, 50)}..." → "${a.answer}"`)
    }
  }

  // Recommendation
  const best = results.reduce((a, b) => {
    if (a.qualityScore !== b.qualityScore) return a.qualityScore > b.qualityScore ? a : b
    return a.avgLatencyMs < b.avgLatencyMs ? a : b
  })
  console.log(`\nRECOMMENDATION: ${best.model} (quality=${best.qualityScore}/10, avg=${best.avgLatencyMs}ms)`)
}

main().catch(console.error)
