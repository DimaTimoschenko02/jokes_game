import { defineConfig } from 'drizzle-kit'

const DATABASE_URL: string =
  process.env.DATABASE_URL ?? 'postgres://punchme:punchme@localhost:5433/punchme'

export default defineConfig({
  schema: './src/db/schema/*.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: DATABASE_URL
  },
  verbose: true,
  strict: true
})
