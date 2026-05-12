import { IsString, Length } from 'class-validator'

export class LoginDto {
  @IsString()
  @Length(3, 30)
  login!: string

  @IsString()
  @Length(6, 100)
  password!: string
}
