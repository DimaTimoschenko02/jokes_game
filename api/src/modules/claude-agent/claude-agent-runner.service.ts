import { Injectable, Logger } from '@nestjs/common'
import spawn from 'cross-spawn'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentConfig } from './models/agent-config.type'
import {
  AgentInvocationError,
  AgentParseError,
  AgentSpawnError,
  AgentTimeoutError
} from './models/agent-errors'
import { AgentResponse, AgentUsage } from './models/agent-response.type'
import { AgentSession } from './models/agent-session.type'

const CLAUDE_CLI_BINARY: string = 'claude'
const WORKING_DIR: string = tmpdir()
const CLAUDE_PROJECTS_DIR_NAME: string = 'projects'

type ClaudeCliJsonResult = {
  readonly type: string
  readonly subtype: string
  readonly is_error: boolean
  readonly api_error_status: string | null
  readonly duration_ms: number
  readonly duration_api_ms: number
  readonly num_turns: number
  readonly result: string
  readonly stop_reason: string
  readonly session_id: string
  readonly total_cost_usd: number
  readonly usage: {
    readonly input_tokens: number
    readonly output_tokens: number
    readonly cache_read_input_tokens: number
    readonly cache_creation_input_tokens: number
  }
}

type InvokeMode =
  | { readonly kind: 'start'; readonly sessionId: string }
  | { readonly kind: 'resume'; readonly sessionId: string }

export type AgentStartResult<T> = {
  readonly session: AgentSession<T>
  readonly response: AgentResponse<T>
}

@Injectable()
export class ClaudeAgentRunnerService {
  private readonly logger: Logger = new Logger(ClaudeAgentRunnerService.name)

  public async start<T>(
    config: AgentConfig<T>,
    initialUserPrompt: string
  ): Promise<AgentStartResult<T>> {
    const sessionId: string = randomUUID()
    const session: AgentSession<T> = {
      id: sessionId,
      config,
      createdAt: new Date()
    }
    const response = await this.invokeWithRetries<T>(config, initialUserPrompt, {
      kind: 'start',
      sessionId
    })
    return { session, response }
  }

  public async continue<T>(
    session: AgentSession<T>,
    userPrompt: string
  ): Promise<AgentResponse<T>> {
    return this.invokeWithRetries<T>(session.config, userPrompt, {
      kind: 'resume',
      sessionId: session.id
    })
  }

  public async end(session: AgentSession<unknown>): Promise<void> {
    const sessionFile: string = this.resolveSessionFilePath(session.id)
    try {
      await rm(sessionFile, { force: true })
      this.logger.log(`agent_session_end agent=${session.config.name} session=${session.id}`)
    } catch (error) {
      this.logger.warn(
        `agent_session_end_fail agent=${session.config.name} session=${session.id} ${(error as Error).message}`
      )
    }
  }

  private async invokeWithRetries<T>(
    config: AgentConfig<T>,
    userPrompt: string,
    mode: InvokeMode
  ): Promise<AgentResponse<T>> {
    let lastError: Error | null = null
    const totalAttempts: number = config.retries + 1
    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        return await this.singleInvoke<T>(config, userPrompt, mode)
      } catch (error) {
        lastError = error as Error
        this.logger.warn(
          `agent_invoke_retry agent=${config.name} mode=${mode.kind} attempt=${attempt}/${totalAttempts} reason="${lastError.message}"`
        )
      }
    }
    throw (
      lastError ??
      new AgentInvocationError(
        `Agent "${config.name}" failed after ${totalAttempts} attempts`,
        '',
        null
      )
    )
  }

  private async singleInvoke<T>(
    config: AgentConfig<T>,
    userPrompt: string,
    mode: InvokeMode
  ): Promise<AgentResponse<T>> {
    const startedAt: number = Date.now()
    const args: string[] = this.buildCliArgs(config, userPrompt, mode)
    return new Promise<AgentResponse<T>>((resolve, reject) => {
      const proc = spawn(CLAUDE_CLI_BINARY, args, {
        cwd: WORKING_DIR,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let timedOut: boolean = false
      const timeoutHandle = setTimeout(() => {
        timedOut = true
        proc.kill('SIGTERM')
      }, config.timeoutMs)
      proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
      proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
      proc.once('error', (error: Error) => {
        clearTimeout(timeoutHandle)
        reject(new AgentSpawnError(`Failed to spawn claude CLI: ${error.message}`, error))
      })
      proc.once('close', (exitCode: number | null) => {
        clearTimeout(timeoutHandle)
        if (timedOut) {
          reject(new AgentTimeoutError(config.name, config.timeoutMs))
          return
        }
        const stdoutText: string = Buffer.concat(stdoutChunks).toString('utf-8')
        const stderrText: string = Buffer.concat(stderrChunks).toString('utf-8')
        if (exitCode !== 0) {
          reject(new AgentInvocationError(`claude exited with code ${exitCode}`, stderrText, exitCode))
          return
        }
        try {
          const cliResult = this.parseCliJson(stdoutText)
          if (cliResult.is_error) {
            reject(
              new AgentInvocationError(`Claude returned error: ${cliResult.result}`, stderrText, exitCode)
            )
            return
          }
          if (cliResult.session_id !== mode.sessionId) {
            this.logger.warn(
              `agent_session_id_mismatch agent=${config.name} expected=${mode.sessionId} got=${cliResult.session_id}`
            )
          }
          const wallClockMs: number = Date.now() - startedAt
          const usage: AgentUsage = {
            inputTokens: cliResult.usage.input_tokens,
            outputTokens: cliResult.usage.output_tokens,
            cacheReadTokens: cliResult.usage.cache_read_input_tokens,
            cacheCreationTokens: cliResult.usage.cache_creation_input_tokens
          }
          const parsed: T | undefined =
            config.outputFormat === 'json' && config.schema
              ? this.parseAgentJson(config, cliResult.result)
              : undefined
          const response: AgentResponse<T> = {
            raw: cliResult.result,
            parsed,
            latencyMs: cliResult.duration_api_ms,
            wallClockMs,
            costUsd: cliResult.total_cost_usd,
            usage
          }
          this.logger.log(
            `agent_invoke_ok agent=${config.name} mode=${mode.kind} session=${mode.sessionId} latency_ms=${response.latencyMs} wall_ms=${response.wallClockMs} cost=${response.costUsd.toFixed(4)} in=${usage.inputTokens} out=${usage.outputTokens} cache_read=${usage.cacheReadTokens} cache_create=${usage.cacheCreationTokens}`
          )
          resolve(response)
        } catch (error) {
          if (error instanceof AgentParseError || error instanceof AgentInvocationError) {
            reject(error)
            return
          }
          reject(
            new AgentParseError(
              `Failed to parse claude CLI output: ${(error as Error).message}`,
              stdoutText,
              error as Error
            )
          )
        }
      })
      proc.stdin?.end()
    })
  }

  private buildCliArgs(
    config: AgentConfig<unknown>,
    userPrompt: string,
    mode: InvokeMode
  ): string[] {
    const args: string[] = [
      '-p',
      userPrompt,
      '--output-format',
      'json',
      '--model',
      config.model
    ]
    if (mode.kind === 'start') {
      args.push('--session-id', mode.sessionId)
      args.push('--system-prompt', config.systemPrompt)
    } else {
      args.push('--resume', mode.sessionId)
    }
    return args
  }

  private parseCliJson(stdoutText: string): ClaudeCliJsonResult {
    const trimmed: string = stdoutText.trim()
    if (trimmed.length === 0) {
      throw new AgentParseError('claude CLI returned empty stdout', stdoutText)
    }
    try {
      return JSON.parse(trimmed) as ClaudeCliJsonResult
    } catch (error) {
      throw new AgentParseError(
        `Invalid CLI JSON envelope: ${(error as Error).message}`,
        stdoutText,
        error as Error
      )
    }
  }

  private parseAgentJson<T>(config: AgentConfig<T>, raw: string): T {
    if (!config.schema) {
      throw new AgentParseError(`Agent "${config.name}" expects JSON but no schema provided`, raw)
    }
    const extracted: string = this.extractJsonPayload(raw)
    let value: unknown
    try {
      value = JSON.parse(extracted)
    } catch (error) {
      throw new AgentParseError(
        `Agent "${config.name}" returned invalid JSON: ${(error as Error).message}`,
        raw,
        error as Error
      )
    }
    const parsed = config.schema.safeParse(value)
    if (!parsed.success) {
      throw new AgentParseError(
        `Agent "${config.name}" output failed schema: ${parsed.error.message}`,
        raw
      )
    }
    return parsed.data
  }

  private extractJsonPayload(raw: string): string {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (fenceMatch) {
      return fenceMatch[1].trim()
    }
    return raw.trim()
  }

  private resolveSessionFilePath(sessionId: string): string {
    const projectDirEncoded: string = this.encodeProjectDir(WORKING_DIR)
    return join(homedir(), '.claude', CLAUDE_PROJECTS_DIR_NAME, projectDirEncoded, `${sessionId}.jsonl`)
  }

  private encodeProjectDir(absolutePath: string): string {
    return absolutePath.replace(/[\\/:]/g, '-')
  }
}
