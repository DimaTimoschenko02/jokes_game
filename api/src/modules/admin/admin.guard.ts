import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { createHmac } from 'crypto'
import { JwtPayload } from '../auth/models/jwt-payload.type'
import { UserRepository } from '../user/user.repository'

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
  private readonly legacyToken: string = generateAdminToken()

  public constructor(
    private readonly jwtService: JwtService,
    private readonly userRepository: UserRepository
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>()
    const authHeader = request.headers['authorization'] ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) {
      throw new UnauthorizedException('Missing admin token')
    }
    if (token === this.legacyToken) {
      return true
    }
    try {
      const payload = this.jwtService.verify<JwtPayload>(token)
      const user = await this.userRepository.findById(payload.sub)
      if (user && user.role === 'admin') {
        return true
      }
    } catch {
      // fall through
    }
    throw new UnauthorizedException('Admin access required')
  }
}
