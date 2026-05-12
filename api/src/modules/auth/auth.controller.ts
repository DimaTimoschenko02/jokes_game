import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { AuthResult, AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'

@Controller('api/auth')
export class AuthController {
  public constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(201)
  public async register(@Body() body: RegisterDto): Promise<AuthResult> {
    return this.authService.register(body)
  }

  @Post('login')
  @HttpCode(200)
  public async login(@Body() body: LoginDto): Promise<AuthResult> {
    return this.authService.login(body)
  }
}
