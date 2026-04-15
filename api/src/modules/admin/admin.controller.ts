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
import { PromptStarterEntry } from '../prompt-starter/models/prompt-starter-entry.type'
import { PromptStarterRepository } from '../prompt-starter/prompt-starter.repository'
import { AdminGuard, generateAdminToken, verifyAdminPassword } from './admin.guard'

@Controller('api/admin')
export class AdminController {
  public constructor(private readonly repository: PromptStarterRepository) {}

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
    @Query('search') search?: string
  ): Promise<{
    items: readonly Record<string, unknown>[]
    total: number
    page: number
    limit: number
  }> {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10) || 20))
    const sortField = ['usedCount', 'createdAt', 'text', 'completionsCount'].includes(sort ?? '')
      ? sort!
      : 'createdAt'
    const sortOrder = order === 'asc' ? 'asc' as const : 'desc' as const

    const result = await this.repository.findPaginated({
      page: pageNum,
      limit: limitNum,
      sort: sortField,
      order: sortOrder
    })

    const items = result.items.map((item) => ({
      _id: item._id,
      text: item.text,
      usedCount: item.usedCount,
      completionsCount: item.completions?.length ?? 0,
      avgVoteShare: this.calcAvgVoteShare(item.completions ?? []),
      createdAt: (item as unknown as { createdAt?: string }).createdAt
    }))

    return { items, total: result.total, page: pageNum, limit: limitNum }
  }

  @Get('prompts/:id')
  @UseGuards(AdminGuard)
  public async getPrompt(@Param('id') id: string): Promise<PromptStarterEntry | { error: string }> {
    const doc = await this.repository.findById(id)
    if (!doc) {
      return { error: 'Not found' }
    }
    return doc
  }

  @Patch('prompts/:id')
  @UseGuards(AdminGuard)
  public async updatePrompt(
    @Param('id') id: string,
    @Body() body: { text?: string }
  ): Promise<{ ok: boolean }> {
    if (body.text && body.text.trim().length > 0) {
      await this.repository.updateText(id, body.text.trim())
    }
    return { ok: true }
  }

  @Delete('prompts/:id')
  @UseGuards(AdminGuard)
  public async deletePrompt(@Param('id') id: string): Promise<{ ok: boolean }> {
    await this.repository.deleteById(id)
    return { ok: true }
  }

  @Delete('prompts/:id/completions/:index')
  @UseGuards(AdminGuard)
  public async deleteCompletion(
    @Param('id') id: string,
    @Param('index') index: string
  ): Promise<{ ok: boolean }> {
    await this.repository.removeCompletion(id, parseInt(index, 10))
    return { ok: true }
  }

  private calcAvgVoteShare(completions: readonly { voteShare?: number }[]): number | null {
    if (completions.length === 0) {
      return null
    }
    const sum = completions.reduce((acc, c) => acc + (c.voteShare ?? 0), 0)
    return Number((sum / completions.length).toFixed(3))
  }
}
