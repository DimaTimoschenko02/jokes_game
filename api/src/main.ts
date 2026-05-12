import 'reflect-metadata'
import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { resolve } from 'path'
import { AppModule } from './app.module'
import { GlobalExceptionFilter } from './common/filters/global-exception.filter'
import { runMigrations } from './db/migrate'

const PORT: number = Number(process.env.PORT ?? 4000)
const DEFAULT_DATABASE_URL: string = 'postgres://punchme:punchme@localhost:5433/punchme'

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap')
  const databaseUrl: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
  const migrationsFolder: string = resolve(process.cwd(), 'drizzle')

  logger.log('running_db_migrations')
  await runMigrations(databaseUrl, migrationsFolder)
  logger.log('db_migrations_complete')

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
  app.enableShutdownHooks()
  await app.listen(PORT)
  logger.log(`api_listening port=${PORT}`)
}

void bootstrap()
