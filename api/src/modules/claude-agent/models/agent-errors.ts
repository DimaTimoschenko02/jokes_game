export class AgentSpawnError extends Error {
  public constructor(message: string, public readonly cause?: Error) {
    super(message)
    this.name = 'AgentSpawnError'
  }
}

export class AgentTimeoutError extends Error {
  public constructor(public readonly agentName: string, public readonly timeoutMs: number) {
    super(`Agent "${agentName}" timed out after ${timeoutMs}ms`)
    this.name = 'AgentTimeoutError'
  }
}

export class AgentParseError extends Error {
  public constructor(message: string, public readonly raw: string, public readonly cause?: Error) {
    super(message)
    this.name = 'AgentParseError'
  }
}

export class AgentInvocationError extends Error {
  public constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null
  ) {
    super(message)
    this.name = 'AgentInvocationError'
  }
}
