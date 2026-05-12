import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { UserMemoryRepository } from '../user/user-memory.repository'
import { UserRepository } from '../user/user.repository'
import { UserProfile } from '../user/models/user-profile.type'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { JwtPayload } from './models/jwt-payload.type'

const BCRYPT_ROUNDS: number = 12

export type AuthResult = {
  readonly token: string
  readonly user: UserProfile
}

@Injectable()
export class AuthService {
  public constructor(
    private readonly userRepository: UserRepository,
    private readonly userMemoryRepository: UserMemoryRepository,
    private readonly jwtService: JwtService
  ) {}

  public async register(input: RegisterDto): Promise<AuthResult> {
    const normalizedLogin: string = input.login.trim().toLowerCase()
    const existing = await this.userRepository.findByLogin(normalizedLogin)
    if (existing) {
      throw new ConflictException('Login already taken')
    }
    const passwordHash: string = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
    const user = await this.userRepository.create({
      login: normalizedLogin,
      passwordHash,
      realName: input.realName.trim(),
      displayName: input.displayName.trim(),
      gender: input.gender,
      bio: input.bio?.trim() || null
    })
    await this.userMemoryRepository.ensureExists(user.id)
    const token: string = this.signToken(user.id, user.login)
    return { token, user }
  }

  public async login(input: LoginDto): Promise<AuthResult> {
    const normalizedLogin: string = input.login.trim().toLowerCase()
    const stored = await this.userRepository.findByLogin(normalizedLogin)
    if (!stored) {
      throw new UnauthorizedException('Invalid credentials')
    }
    const match: boolean = await bcrypt.compare(input.password, stored.passwordHash)
    if (!match) {
      throw new UnauthorizedException('Invalid credentials')
    }
    const profile = await this.userRepository.findById(stored.id)
    if (!profile) {
      throw new BadRequestException('User vanished after login')
    }
    const token: string = this.signToken(profile.id, profile.login)
    return { token, user: profile }
  }

  public verifyToken(token: string): JwtPayload {
    return this.jwtService.verify<JwtPayload>(token)
  }

  private signToken(userId: string, login: string): string {
    return this.jwtService.sign({ sub: userId, login })
  }
}
