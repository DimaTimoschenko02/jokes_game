import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { GlobalExceptionFilter } from './common/filters/global-exception.filter'

const PORT: number = Number(process.env.PORT ?? 4000)

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: true,
      credentials: true
    }
  })
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  )
  app.useGlobalFilters(new GlobalExceptionFilter())
  await app.listen(PORT)
}

void bootstrap()
