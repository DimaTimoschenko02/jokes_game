import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { Db } from './db.types'
import * as schema from './schema'

const DEFAULT_DATABASE_URL: string = 'postgres://punchme:punchme@localhost:5433/punchme'

@Injectable()
export class DbConnection implements OnModuleDestroy {
  private readonly logger: Logger = new Logger(DbConnection.name)
  private readonly client: postgres.Sql
  public readonly db: Db

  public constructor() {
    const url: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
    this.client = postgres(url, { max: 10, prepare: false })
    this.db = drizzle(this.client, { schema })
    this.logger.log(`db_connected url=${this.maskUrl(url)}`)
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.end({ timeout: 5 })
    this.logger.log('db_disconnected')
  }

  private maskUrl(url: string): string {
    return url.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@')
  }
}
