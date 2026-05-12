import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common'
import { IsIn, IsOptional, IsString, Length } from 'class-validator'
import { Request } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import { UserMemoryView } from './models/user-memory-view.type'
import { UserGender, UserProfile } from './models/user-profile.type'
import { UserMemoryService } from './user-memory.service'
import { UserRepository } from './user.repository'

class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  realName?: string

  @IsOptional()
  @IsString()
  @Length(1, 80)
  displayName?: string

  @IsOptional()
  @IsString()
  @IsIn(['male', 'female', 'non-binary', 'not-specified'])
  gender?: UserGender

  @IsOptional()
  @IsString()
  @Length(0, 500)
  bio?: string
}

@Controller('api/users')
@UseGuards(AuthGuard)
export class UserController {
  public constructor(
    private readonly userRepository: UserRepository,
    private readonly userMemoryService: UserMemoryService
  ) {}

  @Get('me')
  public async getMe(@Req() request: Request): Promise<UserProfile> {
    const id: string = this.requireUserId(request)
    const profile = await this.userRepository.findById(id)
    if (!profile) {
      throw new Error('User not found')
    }
    return profile
  }

  @Patch('me')
  public async updateMe(@Req() request: Request, @Body() body: UpdateMeDto): Promise<UserProfile> {
    const id: string = this.requireUserId(request)
    const updated = await this.userRepository.updateProfile(id, {
      realName: body.realName,
      displayName: body.displayName,
      gender: body.gender,
      bio: body.bio === undefined ? undefined : body.bio || null
    })
    if (!updated) {
      throw new Error('User not found')
    }
    return updated
  }

  @Get('me/memory')
  public async getMemory(@Req() request: Request): Promise<UserMemoryView> {
    const id: string = this.requireUserId(request)
    return this.userMemoryService.getOrDefault(id)
  }

  private requireUserId(request: Request): string {
    const user = request.user
    if (!user) {
      throw new Error('No authenticated user on request')
    }
    return user.id
  }
}
