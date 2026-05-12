import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { UserModule } from '../user/user.module'
import { AuthController } from './auth.controller'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'

const DEFAULT_JWT_SECRET: string = 'punchme-dev-secret-change-me'
const DEFAULT_JWT_EXPIRES: string = '30d'

@Global()
@Module({
  imports: [
    UserModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET,
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? DEFAULT_JWT_EXPIRES) as `${number}d` }
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard, JwtModule]
})
export class AuthModule {}
