import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'

type ErrorBody = {
  readonly message: string
}

type HttpResponseLike = {
  status: (code: number) => { json: (payload: ErrorBody) => void }
}

type HttpRequestLike = {
  readonly method: string
  readonly url: string
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger: Logger = new Logger(GlobalExceptionFilter.name)

  public catch(exception: unknown, host: ArgumentsHost): void {
    const details = this.getExceptionDetails(exception)

    // WebSocket exceptions are handled by the gateway-scoped WsLoggingExceptionFilter.
    // This global filter only owns the HTTP context; bail out otherwise to avoid
    // calling switchToHttp() on a non-HTTP host.
    if (host.getType() !== 'http') {
      if (details.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(`unhandled_exception ctx=${host.getType()} message=${details.message}`, this.getStack(exception))
      }
      return
    }

    const httpContext = host.switchToHttp()
    const request = httpContext.getRequest<HttpRequestLike>()
    const response = httpContext.getResponse<HttpResponseLike>()

    if (details.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `unhandled_exception method=${request.method} url=${request.url} status=${details.statusCode} message=${details.message}`,
        this.getStack(exception)
      )
    }

    response.status(details.statusCode).json({ message: details.message })
  }

  private getStack(exception: unknown): string {
    if (exception instanceof Error) {
      return exception.stack ?? '(no stack)'
    }
    return '(non-Error exception)'
  }

  private getExceptionDetails(
    exception: unknown
  ): { readonly statusCode: number; readonly message: string } {
    if (exception instanceof HttpException) {
      return {
        statusCode: exception.getStatus(),
        message: exception.message
      }
    }
    if (exception instanceof Error) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: exception.message
      }
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Unknown error'
    }
  }
}
