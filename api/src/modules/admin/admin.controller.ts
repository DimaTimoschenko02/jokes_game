import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from '@nestjs/common'
import { JokeMemoryRepository } from '../joke-memory/joke-memory.repository'
import { PromptStarterEntry } from '../prompt-starter/models/prompt-starter-entry.type'
import { PromptStarterRepository } from '../prompt-starter/prompt-starter.repository'
import { AdminGuard, generateAdminToken, verifyAdminPassword } from './admin.guard'

const DEFAULT_PAGE_LIMIT: number = 20
const MAX_PAGE_LIMIT: number = 100

type YesNoAll = 'yes' | 'no' | 'all'
type SourceFilter = 'human' | 'bot' | 'all'

const PROMPT_SORT_FIELDS: readonly string[] = [
  'createdAt',
  'usedCount',
  'text',
  'completionsCount',
  'adminScore',
  'feedbackScore',
  'derivedScore',
  'usedAsExampleCount'
]

const JOKE_SORT_FIELDS: readonly string[] = [
  'createdAt',
  'adminScore',
  'ratingAverage',
  'voteShare',
  'qualityScore'
]

const parseYesNo = (value: string | undefined): 'yes' | 'no' | undefined => {
  if (value === 'yes' || value === 'no') {
    return value
  }
  return undefined
}

const parseSource = (value: string | undefined): 'human' | 'bot' | undefined => {
  if (value === 'human' || value === 'bot') {
    return value
  }
  return undefined
}

const parseInt32 = (value: string | undefined, fallback: number, max: number = Number.MAX_SAFE_INTEGER): number => {
  const parsed: number = parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(max, Math.max(1, parsed))
}

const normalizeOrder = (value: string | undefined): 'asc' | 'desc' => (value === 'asc' ? 'asc' : 'desc')

@Controller('api/admin')
export class AdminController {
  public constructor(
    private readonly promptRepository: PromptStarterRepository,
    private readonly jokeRepository: JokeMemoryRepository
  ) {}

  @Post('login')
  public login(@Body() body: { password?: string }): { token: string } | { error: string } {
    if (!body.password || !verifyAdminPassword(body.password)) {
      return { error: 'Wrong password' }
    }
    return { token: generateAdminToken() }
  }

  @Get('prompts')
  @UseGuards(AdminGuard)
  public async listPrompts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('search') search?: string,
    @Query('hasAdminScore') hasAdminScore?: YesNoAll,
    @Query('isSeed') isSeed?: YesNoAll,
    @Query('isGolden') isGolden?: YesNoAll
  ): Promise<{
    items: readonly Record<string, unknown>[]
    total: number
    page: number
    limit: number
  }> {
    const pageNum: number = parseInt32(page, 1)
    const limitNum: number = parseInt32(limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
    const sortField: string = PROMPT_SORT_FIELDS.includes(sort ?? '') ? (sort as string) : 'createdAt'

    const result = await this.promptRepository.findPaginated({
      page: pageNum,
      limit: limitNum,
      sort: sortField,
      order: normalizeOrder(order),
      search,
      hasAdminScore: parseYesNo(hasAdminScore),
      isSeed: parseYesNo(isSeed),
      isGolden: parseYesNo(isGolden)
    })

    const items = result.items.map((item) => this.serializePrompt(item))
    return { items, total: result.total, page: pageNum, limit: limitNum }
  }

  @Get('prompts/:id')
  @UseGuards(AdminGuard)
  public async getPrompt(@Param('id') id: string): Promise<PromptStarterEntry | { error: string }> {
    const doc = await this.promptRepository.findById(id)
    if (!doc) {
      return { error: 'Not found' }
    }
    return doc
  }

  @Patch('prompts/:id')
  @UseGuards(AdminGuard)
  public async updatePrompt(
    @Param('id') id: string,
    @Body() body: {
      text?: string
      adminScore?: number | null
      adminComment?: string | null
      isGolden?: boolean
    }
  ): Promise<{ ok: boolean }> {
    const updates: {
      text?: string
      adminScore?: number | null
      adminComment?: string | null
      adminScoredBy?: string
      isGolden?: boolean
    } = {}
    if (typeof body.text === 'string' && body.text.trim().length > 0) {
      updates.text = body.text.trim()
    }
    if (body.adminScore === null) {
      updates.adminScore = null
    } else if (typeof body.adminScore === 'number') {
      updates.adminScore = Math.min(10, Math.max(1, Math.floor(body.adminScore)))
      updates.adminScoredBy = 'admin'
    }
    if (body.adminComment === null) {
      updates.adminComment = null
    } else if (typeof body.adminComment === 'string') {
      updates.adminComment = body.adminComment.trim()
    }
    if (typeof body.isGolden === 'boolean') {
      updates.isGolden = body.isGolden
    }
    await this.promptRepository.updateAdminFields(id, updates)
    return { ok: true }
  }

  @Delete('prompts/:id')
  @UseGuards(AdminGuard)
  public async deletePrompt(@Param('id') id: string): Promise<{ ok: boolean }> {
    await this.promptRepository.deleteById(id)
    return { ok: true }
  }

  @Delete('prompts/:id/completions/:index')
  @UseGuards(AdminGuard)
  public async deleteCompletion(
    @Param('id') id: string,
    @Param('index') index: string
  ): Promise<{ ok: boolean }> {
    await this.promptRepository.removeCompletion(id, parseInt(index, 10))
    return { ok: true }
  }

  @Get('jokes')
  @UseGuards(AdminGuard)
  public async listJokes(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('search') search?: string,
    @Query('source') source?: SourceFilter,
    @Query('hasAdminScore') hasAdminScore?: YesNoAll,
    @Query('hasRating') hasRating?: YesNoAll,
    @Query('isSeed') isSeed?: YesNoAll
  ): Promise<{
    items: readonly Record<string, unknown>[]
    total: number
    page: number
    limit: number
  }> {
    const pageNum: number = parseInt32(page, 1)
    const limitNum: number = parseInt32(limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
    const sortField = (JOKE_SORT_FIELDS.includes(sort ?? '') ? sort : 'createdAt') as
      | 'createdAt'
      | 'adminScore'
      | 'ratingAverage'
      | 'voteShare'
      | 'qualityScore'

    const result = await this.jokeRepository.findPaginatedForAdmin({
      page: pageNum,
      limit: limitNum,
      sort: sortField,
      order: normalizeOrder(order),
      search,
      source: parseSource(source),
      hasAdminScore: parseYesNo(hasAdminScore),
      hasRating: parseYesNo(hasRating),
      isSeed: parseYesNo(isSeed)
    })

    const items = result.items.map((item) => this.serializeJoke(item))
    return { items, total: result.total, page: pageNum, limit: limitNum }
  }

  @Get('jokes/:id')
  @UseGuards(AdminGuard)
  public async getJoke(@Param('id') id: string): Promise<Record<string, unknown> | { error: string }> {
    const doc = await this.jokeRepository.findOneForAdmin(id)
    if (!doc) {
      return { error: 'Not found' }
    }
    return this.serializeJoke(doc)
  }

  @Patch('jokes/:id')
  @UseGuards(AdminGuard)
  public async updateJoke(
    @Param('id') id: string,
    @Body() body: {
      adminScore?: number | null
      adminComment?: string | null
    }
  ): Promise<{ ok: boolean }> {
    const updates: {
      adminScore?: number | null
      adminComment?: string | null
      adminScoredBy?: string
    } = {}
    if (body.adminScore === null) {
      updates.adminScore = null
    } else if (typeof body.adminScore === 'number') {
      updates.adminScore = Math.min(10, Math.max(1, Math.floor(body.adminScore)))
      updates.adminScoredBy = 'admin'
    }
    if (body.adminComment === null) {
      updates.adminComment = null
    } else if (typeof body.adminComment === 'string') {
      updates.adminComment = body.adminComment.trim()
    }
    await this.jokeRepository.updateAdminFields(id, updates)
    return { ok: true }
  }

  @Delete('jokes/:id')
  @UseGuards(AdminGuard)
  public async deleteJoke(@Param('id') id: string): Promise<{ ok: boolean }> {
    await this.jokeRepository.deleteById(id)
    return { ok: true }
  }

  private serializePrompt(item: PromptStarterEntry): Record<string, unknown> {
    return {
      id: item._id,
      text: item.text,
      usedCount: item.usedCount,
      completionsCount: item.completions?.length ?? 0,
      avgVoteShare: this.calcAvgVoteShare(item.completions ?? []),
      isGolden: item.isGolden ?? false,
      feedbackScore: item.feedbackScore,
      feedbackSum: item.userQuickFeedback.sum,
      feedbackCount: item.userQuickFeedback.count,
      adminScore: item.adminScore ?? null,
      adminComment: item.adminComment ?? null,
      adminScoredBy: item.adminScoredBy ?? null,
      adminScoredAt: item.adminScoredAt ?? null,
      derivedScore: item.derivedScore ?? null,
      usedAsExampleCount: item.usedAsExampleCount,
      lastUsedAsExampleAt: item.lastUsedAsExampleAt ?? null
    }
  }

  private serializeJoke(item: import('../joke-memory/models/joke-memory-entry.type').JokeMemoryEntry): Record<string, unknown> {
    return {
      id: item.id,
      prompt: item.prompt,
      punchline: item.punchline,
      source: item.source,
      authorRealName: item.authorRealName ?? null,
      roomCode: item.roomCode,
      roundIndex: item.roundIndex,
      votesFor: item.votesFor,
      votesAgainst: item.votesAgainst,
      voteShare: item.voteShare,
      qualityScore: item.qualityScore,
      ratingAverage: item.ratingAverage ?? null,
      ratingCount: item.ratingCount ?? null,
      adminScore: item.adminScore ?? null,
      adminComment: item.adminComment ?? null,
      adminScoredBy: item.adminScoredBy ?? null,
      adminScoredAt: item.adminScoredAt ?? null,
      usedAsExampleCount: item.usedAsExampleCount,
      createdAt: item.createdAt
    }
  }

  private calcAvgVoteShare(completions: readonly { voteShare?: number }[]): number | null {
    if (completions.length === 0) {
      return null
    }
    const sum = completions.reduce((acc, c) => acc + (c.voteShare ?? 0), 0)
    return Number((sum / completions.length).toFixed(3))
  }
}
