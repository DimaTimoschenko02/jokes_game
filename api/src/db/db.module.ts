import { Global, Module } from '@nestjs/common'
import { DbConnection } from './db.connection'

export const DATABASE = 'DRIZZLE_DB'

@Global()
@Module({
  providers: [
    DbConnection,
    {
      provide: DATABASE,
      useFactory: (connection: DbConnection) => connection.db,
      inject: [DbConnection]
    }
  ],
  exports: [DATABASE, DbConnection]
})
export class DbModule {}
