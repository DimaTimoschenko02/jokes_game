import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator'

export class RegisterDto {
  @IsString()
  @Length(3, 30)
  @Matches(/^[a-z0-9_-]+$/i, { message: 'login must be alphanumeric, dashes or underscores' })
  login!: string

  @IsString()
  @Length(6, 100)
  password!: string

  @IsString()
  @Length(1, 80)
  realName!: string

  @IsString()
  @Length(1, 80)
  displayName!: string

  @IsString()
  @IsIn(['male', 'female', 'non-binary', 'not-specified'])
  gender!: 'male' | 'female' | 'non-binary' | 'not-specified'

  @IsOptional()
  @IsString()
  @Length(0, 500)
  bio?: string
}
