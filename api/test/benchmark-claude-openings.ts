/**
 * Benchmark: compare Claude models × effort levels on joke OPENING generation.
 *
 * Runs the production OPENING_GENERATION_SYSTEM_PROMPT against each combo,
 * generating N openings each. Stage-1 only (no filter), to isolate the model's
 * raw output. Saves results to JSON + prints a readable report.
 *
 * Usage:
 *   npx tsx api/test/benchmark-claude-openings.ts
 *
 * Env overrides:
 *   COUNT=10                       openings per combo
 *   OUT_DIR=api/test/results       output directory
 */

import spawn from 'cross-spawn'
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  OPENING_GENERATION_SYSTEM_PROMPT,
  createOpeningGenerationUserPrompt
} from '../src/modules/ai/prompts/prompt-templates'

interface Combo {
  readonly model: string
  readonly effort: string
  readonly label: string
}

interface ComboResult {
  readonly combo: Combo
  readonly latencyMs: number
  readonly costUsd: number | null
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cacheReadTokens: number | null
  readonly cacheCreationTokens: number | null
  readonly rawResult: string
  readonly openings: readonly string[]
  readonly parseStatus: 'ok' | 'partial' | 'failed'
  readonly error: string | null
}

interface ClaudeJsonResponse {
  is_error?: boolean
  result?: string
  duration_ms?: number
  total_cost_usd?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  modelUsage?: Record<string, {
    inputTokens?: number
    outputTokens?: number
    cacheReadInputTokens?: number
    cacheCreationInputTokens?: number
    costUSD?: number
  }>
  [k: string]: unknown
}

const COUNT: number = Number(process.env.COUNT ?? 10)
const OUT_DIR: string = process.env.OUT_DIR ?? resolve(__dirname, 'results')
const TIMEOUT_MS: number = 300_000
// Spawn claude CLI from a clean tmp dir so its default agent prompt does NOT
// pick up our repo's git state and try to "help" with untracked files.
const CLEAN_CWD: string = mkdtempSync(resolve(tmpdir(), 'claude-bench-'))

const COMBOS: readonly Combo[] = [
  { model: 'claude-sonnet-4-6', effort: 'medium', label: 'sonnet-4-6 / med' },
  { model: 'claude-sonnet-4-6', effort: 'high',   label: 'sonnet-4-6 / high' },
  { model: 'claude-opus-4-6',   effort: 'medium', label: 'opus-4-6 / med' },
  { model: 'claude-opus-4-6',   effort: 'xhigh',  label: 'opus-4-6 / xhigh' },
  { model: 'claude-opus-4-7',   effort: 'medium', label: 'opus-4-7 / med' },
  { model: 'claude-opus-4-7',   effort: 'xhigh',  label: 'opus-4-7 / xhigh' },
]

function runClaude(model: string, effort: string, systemPrompt: string, userMessage: string): Promise<{
  raw: string
  json: ClaudeJsonResponse | null
  elapsedMs: number
  error: string | null
}> {
  return new Promise((resolveFn) => {
    const args: string[] = [
      '-p',
      '--model', model,
      '--effort', effort,
      '--system-prompt', systemPrompt,
      '--output-format', 'json'
    ]
    const startMs = Date.now()
    const proc = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: TIMEOUT_MS, cwd: CLEAN_CWD })
    proc.stdin?.write(userMessage)
    proc.stdin?.end()
    const out: Buffer[] = []
    const err: Buffer[] = []
    proc.stdout?.on('data', (d: Buffer) => out.push(d))
    proc.stderr?.on('data', (d: Buffer) => err.push(d))
    proc.on('error', (e) => resolveFn({ raw: '', json: null, elapsedMs: Date.now() - startMs, error: e.message }))
    proc.on('close', () => {
      const stdout = Buffer.concat(out).toString('utf-8').trim()
      const stderr = Buffer.concat(err).toString('utf-8').trim()
      let parsed: ClaudeJsonResponse | null = null
      try {
        parsed = JSON.parse(stdout) as ClaudeJsonResponse
      } catch {
        /* keep raw */
      }
      const errorMsg = parsed?.is_error
        ? `claude reported is_error: ${parsed.result ?? 'unknown'}`
        : stderr || null
      resolveFn({ raw: stdout, json: parsed, elapsedMs: Date.now() - startMs, error: errorMsg })
    })
  })
}

function parseOpenings(content: string): { openings: string[]; status: 'ok' | 'partial' | 'failed' } {
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (jsonMatch) {
    const sanitized = jsonMatch[0].replace(/;/g, ',')
    try {
      const parsed: unknown = JSON.parse(sanitized)
      if (Array.isArray(parsed)) {
        const strs = parsed.filter((x): x is string => typeof x === 'string' && x.trim().length >= 5)
        return { openings: strs, status: strs.length === parsed.length ? 'ok' : 'partial' }
      }
    } catch {
      /* fallthrough */
    }
  }
  const lines = content
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((l) => l.length >= 5 && l.length <= 200)
  if (lines.length > 0) return { openings: lines, status: 'partial' }
  return { openings: [], status: 'failed' }
}

async function runCombo(combo: Combo, count: number): Promise<ComboResult> {
  const userMessage = createOpeningGenerationUserPrompt(count, [], '', [], [])
  process.stdout.write(`  → ${combo.label}  ...`)
  const { raw, json, elapsedMs, error } = await runClaude(
    combo.model,
    combo.effort,
    OPENING_GENERATION_SYSTEM_PROMPT,
    userMessage
  )
  const content = json?.result ?? raw
  const { openings, status } = parseOpenings(content)
  const usage = json?.modelUsage?.[combo.model]
  process.stdout.write(` done ${elapsedMs}ms (${openings.length} parsed, $${(json?.total_cost_usd ?? 0).toFixed(4)})\n`)
  return {
    combo,
    latencyMs: elapsedMs,
    costUsd: json?.total_cost_usd ?? null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheReadTokens: usage?.cacheReadInputTokens ?? null,
    cacheCreationTokens: usage?.cacheCreationInputTokens ?? null,
    rawResult: content,
    openings,
    parseStatus: status,
    error
  }
}

function tsStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function renderReport(results: readonly ComboResult[]): string {
  const lines: string[] = []
  lines.push('# Opening generation benchmark')
  lines.push('')
  lines.push(`Count per combo: **${COUNT}**`)
  lines.push(`Date: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push('| Combo | Latency | Parsed | Cost | In tok | Out tok | Status |')
  lines.push('|---|---:|---:|---:|---:|---:|:--|')
  for (const r of results) {
    lines.push(
      `| ${r.combo.label} | ${(r.latencyMs / 1000).toFixed(1)}s | ${r.openings.length}/${COUNT} | ${r.costUsd !== null ? `$${r.costUsd.toFixed(4)}` : 'n/a'} | ${r.inputTokens ?? 'n/a'} | ${r.outputTokens ?? 'n/a'} | ${r.parseStatus}${r.error ? ' ⚠' : ''} |`
    )
  }
  lines.push('')
  for (const r of results) {
    lines.push(`## ${r.combo.label}`)
    lines.push(`model=${r.combo.model} effort=${r.combo.effort} latency=${r.latencyMs}ms cost=$${(r.costUsd ?? 0).toFixed(4)}`)
    if (r.error) lines.push(`**Error:** ${r.error}`)
    lines.push('')
    if (r.openings.length === 0) {
      lines.push('_(no openings parsed)_')
      lines.push('')
      lines.push('Raw output:')
      lines.push('```')
      lines.push(r.rawResult.slice(0, 1000))
      lines.push('```')
    } else {
      r.openings.forEach((o, i) => lines.push(`${i + 1}. ${o}`))
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  console.log(`Combos: ${COMBOS.length}, count per combo: ${COUNT}`)
  console.log('')
  const results: ComboResult[] = []
  for (const combo of COMBOS) {
    const r = await runCombo(combo, COUNT)
    results.push(r)
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const stamp = tsStamp()
  const jsonPath = resolve(OUT_DIR, `openings-${stamp}.json`)
  const mdPath = resolve(OUT_DIR, `openings-${stamp}.md`)
  writeFileSync(jsonPath, JSON.stringify({ count: COUNT, results }, null, 2), 'utf-8')
  const report = renderReport(results)
  writeFileSync(mdPath, report, 'utf-8')
  console.log('')
  console.log(`Saved: ${jsonPath}`)
  console.log(`Saved: ${mdPath}`)
  console.log('')
  console.log(report)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
