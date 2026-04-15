import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { createHmac } from 'crypto'

const ADMIN_PASSWORD: string = '1902'
const TOKEN_SECRET: string = 'punchme-admin-local'

export const generateAdminToken = (): string => {
  return createHmac('sha256', TOKEN_SECRET).update(ADMIN_PASSWORD).digest('hex').slice(0, 32)
}

export const verifyAdminPassword = (password: string): boolean => {
  return password === ADMIN_PASSWORD
}

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly validToken: string = generateAdminToken()

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>()
    const authHeader = request.headers['authorization'] ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (token !== this.validToken) {
      throw new UnauthorizedException('Invalid admin token')
    }
    return true
  }
}
