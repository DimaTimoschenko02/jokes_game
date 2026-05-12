import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

export async function runMigrations(
  databaseUrl: string,
  migrationsFolder: string
): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 })
  try {
    await client.unsafe('CREATE EXTENSION IF NOT EXISTS vector')
    const migrator = drizzle(client)
    await migrate(migrator, { migrationsFolder })
  } finally {
    await client.end({ timeout: 5 })
  }
}
