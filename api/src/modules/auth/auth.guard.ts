import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Request } from 'express'
import { AuthService } from './auth.service'
import { AuthenticatedUser } from './models/jwt-payload.type'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser
    }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  public constructor(private readonly authService: AuthService) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const token: string | null = this.extractToken(request)
    if (!token) {
      throw new UnauthorizedException('Missing token')
    }
    try {
      const payload = this.authService.verifyToken(token)
      request.user = { id: payload.sub, login: payload.login }
      return true
    } catch {
      throw new UnauthorizedException('Invalid token')
    }
  }

  private extractToken(request: Request): string | null {
    const header: string | undefined = request.headers.authorization
    if (!header) {
      return null
    }
    const match = header.match(/^Bearer\s+(.+)$/i)
    return match ? match[1] : null
  }
}
