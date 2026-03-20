import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'

type ErrorBody = {
  readonly message: string
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const response = context.getResponse<{ status: (code: number) => { json: (payload: ErrorBody) => void } }>()
    const details = this.getExceptionDetails(exception)
    response.status(details.statusCode).json({ message: details.message })
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
