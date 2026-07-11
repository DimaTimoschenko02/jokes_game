import { ArgumentsHost, Catch, Logger } from '@nestjs/common'
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets'
import type { Socket } from 'socket.io'

type SocketWithUser = Socket & { data?: { userId?: string } }

/**
 * Logs unhandled exceptions thrown inside @SubscribeMessage handlers with full
 * stack + event/room/user context, then defers to the default base filter so the
 * client still receives the standard 'exception' event. Without this, a throw in a
 * gateway handler is emitted to the client but leaves no server-side stack — a
 * silent failure that is impossible to diagnose from logs.
 *
 * Expected WsExceptions (e.g. validation errors, already warned at the pipe level)
 * are passed through without an error-level log to avoid duplicate noise.
 */
@Catch()
export class WsLoggingExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger: Logger = new Logger('GameGateway')

  public catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof WsException) {
      super.catch(exception, host)
      return
    }

    const ws = host.switchToWs()
    const client = ws.getClient<SocketWithUser>()
    const event: string = this.resolveEvent(ws)
    const room: string = this.resolveRoom(ws.getData())
    const userId: string = client.data?.userId ?? 'unknown'
    const message: string = exception instanceof Error ? exception.message : String(exception)
    const stack: string = exception instanceof Error ? exception.stack ?? '(no stack)' : '(non-Error exception)'

    this.logger.error(`ws_handler_error event=${event} room=${room} user=${userId} message=${message}`, stack)

    super.catch(exception, host)
  }

  private resolveEvent(ws: { getPattern?: () => string }): string {
    return typeof ws.getPattern === 'function' ? ws.getPattern() : 'unknown'
  }

  private resolveRoom(data: unknown): string {
    if (data && typeof data === 'object' && 'roomCode' in data) {
      const roomCode = (data as Record<string, unknown>).roomCode
      return typeof roomCode === 'string' ? roomCode : 'unknown'
    }
    return 'unknown'
  }
}
