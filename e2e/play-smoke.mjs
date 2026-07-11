// PunchMe 2-player smoke playthrough.
//
// Drives the deployed app with two isolated browser contexts (host + guest) plus
// the requested number of bots, plays N rounds end-to-end, and captures every
// client-side error signal per context (console errors, page errors, HTTP >=400
// responses, failed requests, and the in-app errorMessage banner).
//
// Users are logged in (or registered on first run). To create a TEST room the host
// must be an admin — promote it once on the server:
//   UPDATE users SET role='admin' WHERE LOWER(login)='e2e_host';
// then reload picks up the role via GET /api/users/me.
//
// Usage:
//   node e2e/play-smoke.mjs                 # headless, prod
//   HEADED=1 node e2e/play-smoke.mjs        # watch it play
//   BASE_URL=http://localhost:5173 node e2e/play-smoke.mjs
//
// Env: BASE_URL, ROUNDS, BOTS, HEADED, TEST_ROOM(=1 default), SLOWMO(ms)

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ARTIFACTS = join(HERE, 'artifacts')
mkdirSync(ARTIFACTS, { recursive: true })

const BASE_URL = process.env.BASE_URL ?? 'https://punchme.oldgod.online'
const ROUNDS = Number(process.env.ROUNDS ?? 2)
const BOTS = Number(process.env.BOTS ?? 2)
const HEADED = process.env.HEADED === '1'
const TEST_ROOM = process.env.TEST_ROOM !== '0'
const SLOWMO = Number(process.env.SLOWMO ?? 0)
const PASSWORD = process.env.E2E_PASSWORD ?? 'e2ePassw0rd'

const PLAYERS = [
  { key: 'host', login: process.env.HOST_LOGIN ?? 'e2e_host', name: 'E2E Host', nick: 'E2EHost', isHost: true },
  { key: 'guest', login: process.env.GUEST_LOGIN ?? 'e2e_guest', name: 'E2E Guest', nick: 'E2EGuest', isHost: false }
]

const now = () => Date.now()
const elapsed = (start) => `${((now() - start) / 1000).toFixed(0)}s`
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- per-context error capture -------------------------------------------------

function attachErrorCapture(page, bucket) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.consoleErrors.push({ t: now(), text: msg.text() })
  })
  page.on('pageerror', (err) => {
    bucket.pageErrors.push({ t: now(), text: err.message, stack: err.stack })
  })
  page.on('requestfailed', (req) => {
    bucket.requestFailures.push({ t: now(), url: req.url(), method: req.method(), reason: req.failure()?.errorText })
  })
  page.on('response', async (res) => {
    const status = res.status()
    if (status < 400) return
    const entry = { t: now(), url: res.url(), status, method: res.request().method() }
    try {
      const ct = res.headers()['content-type'] ?? ''
      if (ct.includes('json') || ct.includes('text')) entry.body = (await res.text()).slice(0, 500)
    } catch {
      // body already consumed / streamed — ignore
    }
    bucket.httpErrors.push(entry)
  })
}

const newBucket = () => ({ consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [], appErrors: [] })

// snapshot the in-app error banner if present
async function captureAppError(page, bucket) {
  const banner = page.locator('.errorText').first()
  if (await banner.isVisible().catch(() => false)) {
    const text = (await banner.textContent().catch(() => ''))?.trim()
    if (text && !bucket.appErrors.some((e) => e.text === text)) {
      bucket.appErrors.push({ t: now(), text })
      log(`⚠️  app errorMessage: ${text}`)
    }
  }
}

// ---- auth ----------------------------------------------------------------------

async function loginOrRegister(page, player) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  // already authed (restored session)?
  if (await page.getByRole('heading', { name: 'PunchMe Party' }).isVisible().catch(() => false)) return

  await page.getByRole('heading', { name: 'PunchMe' }).waitFor({ timeout: 20000 })
  // login mode is default
  await page.getByRole('textbox', { name: 'Логин' }).fill(player.login)
  await page.getByRole('textbox', { name: 'Пароль' }).fill(PASSWORD)
  await page.locator('button.primary').click()

  const lobby = page.getByRole('heading', { name: 'PunchMe Party' })
  const failed = page.locator('.errorText')
  const outcome = await Promise.race([
    lobby.waitFor({ timeout: 8000 }).then(() => 'ok').catch(() => 'timeout'),
    failed.waitFor({ timeout: 8000 }).then(() => 'error').catch(() => 'timeout')
  ])
  if (outcome === 'ok' && (await lobby.isVisible())) return

  // login failed -> register
  log(`${player.key}: login failed, registering ${player.login}`)
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await page.getByRole('textbox', { name: 'Логин' }).fill(player.login)
  await page.getByRole('textbox', { name: 'Пароль' }).fill(PASSWORD)
  await page.getByRole('textbox', { name: /Имя/ }).fill(player.name)
  await page.getByRole('textbox', { name: /Никнейм/ }).fill(player.nick)
  await page.locator('button.primary').click()
  await lobby.waitFor({ timeout: 15000 })
}

// ---- lobby ---------------------------------------------------------------------

async function createRoom(page) {
  await page.reload({ waitUntil: 'domcontentloaded' }) // refresh role (admin) via getMe
  await page.getByRole('heading', { name: 'PunchMe Party' }).waitFor({ timeout: 20000 })

  await page.getByRole('combobox', { name: 'Раунды' }).selectOption(String(ROUNDS)).catch(async () => {
    await page.locator('select').first().selectOption(String(ROUNDS))
  })
  await page.getByRole('combobox', { name: 'Боты' }).selectOption(String(BOTS)).catch(async () => {
    await page.locator('select').nth(1).selectOption(String(BOTS))
  })

  if (TEST_ROOM) {
    const checkbox = page.locator('input[type="checkbox"]')
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.check()
      log('host: test-room checkbox ON')
    } else {
      throw new Error('TEST_ROOM requested but checkbox not visible — host is not admin (promote e2e_host to admin)')
    }
  }

  await page.getByRole('button', { name: 'Создать комнату' }).click()
  const header = page.getByRole('heading', { name: /Комната [A-Z0-9]{5}/ })
  await header.waitFor({ timeout: 15000 })
  const text = await header.textContent()
  const code = text.match(/Комната ([A-Z0-9]{5})/)[1]
  if (TEST_ROOM && !(await page.getByText('TEST').first().isVisible().catch(() => false))) {
    log('⚠️  TEST badge not shown despite test-room request')
  }
  return code
}

async function joinRoom(page, code) {
  await page.getByPlaceholder('Введи код...').fill(code)
  await page.getByRole('button', { name: /Присоединиться/ }).click()
  await page.getByRole('heading', { name: new RegExp(`Комната ${code}`) }).waitFor({ timeout: 15000 })
}

async function startGame(page) {
  // wait for AI openings ready (or start button enabled)
  const ready = page.getByText('Шутки готовы — можно начинать!')
  await ready.waitFor({ timeout: 90000 }).catch(() => log('host: AI-ready badge not seen, trying start anyway'))
  const startBtn = page.getByRole('button', { name: 'Начать игру' })
  await startBtn.waitFor({ timeout: 90000 })
  await startBtn.click()
}

// ---- phase detection & play ----------------------------------------------------

async function detectPhase(page) {
  const checks = [
    ['finished', page.getByRole('heading', { name: 'Игра окончена!' })],
    ['writing', page.getByRole('heading', { name: 'Закончи оба предложения' })],
    ['rating', page.getByRole('heading', { name: 'Оцени шутки' })],
    ['scoreboard', page.getByRole('heading', { name: 'Раунд завершён' })],
    ['voting', page.getByText(/Дуэль \d+ из \d+/)],
    ['lobby', page.getByText('Ожидание игроков...')]
  ]
  for (const [name, loc] of checks) {
    if (await loc.first().isVisible().catch(() => false)) return name
  }
  return 'unknown'
}

async function doWriting(page, who) {
  const submit = page.getByRole('button', { name: 'Отправить ответы' })
  if (!(await submit.isVisible().catch(() => false))) return // already submitted
  const areas = page.locator('textarea[placeholder="Напиши продолжение..."]')
  const count = await areas.count()
  for (let i = 0; i < count; i++) {
    const a = areas.nth(i)
    if (await a.isEditable().catch(() => false)) await a.fill(`${who} панчлайн ${i + 1} — ${Math.floor(Math.random() * 1e4)}`)
  }
  if (await submit.isEnabled().catch(() => false)) {
    await submit.click()
    log(`${who}: answers submitted`)
  }
}

async function doVoting(page, who) {
  // vote on the current duel if eligible; never our own duel
  const tagA = page.getByRole('button', { name: /Вариант A/ }).first()
  const tagB = page.getByRole('button', { name: /Вариант B/ }).first()
  for (const btn of [tagA, tagB]) {
    if ((await btn.isVisible().catch(() => false)) && (await btn.isEnabled().catch(() => false))) {
      await btn.click().catch(() => {})
      log(`${who}: voted`)
      return
    }
  }
  // participant or already voted -> nothing to do
}

async function doRating(page, who) {
  const items = page.locator('.ratingItem')
  const n = await items.count()
  for (let i = 0; i < n; i++) {
    const item = items.nth(i)
    if (await item.locator('.ratingSelf').isVisible().catch(() => false)) continue // own joke
    const score = item.getByRole('button', { name: String(5 + (i % 5)), exact: true }).first()
    await score.click().catch(() => {})
  }
  const submit = page.getByRole('button', { name: 'Отправить оценки' })
  if (await submit.isEnabled().catch(() => false)) {
    await submit.click()
    log(`${who}: ratings submitted`)
  }
}

async function drivePlayer(page, who, bucket, deadline) {
  let last = ''
  let idle = 0
  while (now() < deadline) {
    await captureAppError(page, bucket)
    const phase = await detectPhase(page)
    if (phase !== last) {
      log(`${who}: phase -> ${phase}`)
      last = phase
      idle = 0
    }
    if (phase === 'finished') return 'finished'
    if (phase === 'writing') await doWriting(page, who)
    else if (phase === 'voting') await doVoting(page, who)
    else if (phase === 'rating') await doRating(page, who)
    // scoreboard / lobby / unknown -> just wait
    await sleep(1200)
    if (++idle > 600) return 'stuck' // ~12 min without finishing
  }
  return 'timeout'
}

// ---- main ----------------------------------------------------------------------

async function main() {
  const start = now()
  log(`launching chromium (headed=${HEADED}) -> ${BASE_URL}, rounds=${ROUNDS}, bots=${BOTS}, testRoom=${TEST_ROOM}`)
  const browser = await chromium.launch({ headless: !HEADED, slowMo: SLOWMO })
  const buckets = {}
  const pages = {}
  const contexts = []
  try {
    for (const p of PLAYERS) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      contexts.push(ctx)
      const page = await ctx.newPage()
      buckets[p.key] = newBucket()
      attachErrorCapture(page, buckets[p.key])
      pages[p.key] = page
    }

    for (const p of PLAYERS) {
      await loginOrRegister(pages[p.key], p)
      log(`${p.key}: authed (${p.login})`)
    }

    const code = await createRoom(pages.host)
    log(`room created: ${code}`)
    await joinRoom(pages.guest, code)
    log('guest joined')

    await startGame(pages.host)
    log('game started')

    const deadline = now() + 20 * 60 * 1000
    const results = await Promise.all([
      drivePlayer(pages.host, 'host', buckets.host, deadline),
      drivePlayer(pages.guest, 'guest', buckets.guest, deadline)
    ])
    log(`drivers finished: host=${results[0]} guest=${results[1]} (${elapsed(start)})`)

    // final scoreboard
    const scores = await pages.host.locator('ul.scoreboard li').allTextContents().catch(() => [])
    log('final scoreboard:', JSON.stringify(scores))

    for (const p of PLAYERS) {
      await pages[p.key].screenshot({ path: join(ARTIFACTS, `final-${p.key}.png`), fullPage: true }).catch(() => {})
    }

    const report = {
      base: BASE_URL,
      rounds: ROUNDS,
      bots: BOTS,
      testRoom: TEST_ROOM,
      roomCode: code,
      durationSec: Math.round((now() - start) / 1000),
      driverResults: { host: results[0], guest: results[1] },
      finalScoreboard: scores,
      errors: buckets
    }
    writeFileSync(join(ARTIFACTS, 'report.json'), JSON.stringify(report, null, 2))

    const totalErr = Object.values(buckets).reduce(
      (s, b) => s + b.consoleErrors.length + b.pageErrors.length + b.httpErrors.length + b.requestFailures.length + b.appErrors.length,
      0
    )
    log('================ SUMMARY ================')
    for (const [k, b] of Object.entries(buckets)) {
      log(`${k}: console=${b.consoleErrors.length} pageErr=${b.pageErrors.length} http>=400=${b.httpErrors.length} reqFail=${b.requestFailures.length} appErr=${b.appErrors.length}`)
      for (const e of b.httpErrors) log(`   HTTP ${e.status} ${e.method} ${e.url} ${e.body ? '— ' + e.body : ''}`)
      for (const e of b.appErrors) log(`   APP  ${e.text}`)
      for (const e of b.pageErrors) log(`   PAGE ${e.text}`)
    }
    log(`TOTAL error signals: ${totalErr}. Report: e2e/artifacts/report.json`)
    process.exitCode = results.every((r) => r === 'finished') && totalErr === 0 ? 0 : 1
  } catch (err) {
    log('FATAL:', err.message)
    for (const [k, page] of Object.entries(pages)) {
      await page.screenshot({ path: join(ARTIFACTS, `fatal-${k}.png`), fullPage: true }).catch(() => {})
    }
    process.exitCode = 2
    throw err
  } finally {
    await sleep(500)
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
