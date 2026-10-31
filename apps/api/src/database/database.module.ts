import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import * as schema from './schema';

export const SQL_CLIENT = Symbol('SQL_CLIENT');
export const DATABASE = Symbol('DATABASE');

export type Database = PostgresJsDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: SQL_CLIENT,
      inject: [ENV],
      useFactory: (env: Env): Sql =>
        postgres(env.DATABASE_URL, {
          max: 10,
          connect_timeout: 10,
          connection: { statement_timeout: 15_000 },
        }),
    },
    {
      provide: DATABASE,
      inject: [SQL_CLIENT],
      useFactory: (client: Sql): Database => drizzle(client, { schema }),
    },
  ],
  exports: [DATABASE, SQL_CLIENT],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(SQL_CLIENT) private readonly client: Sql) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}
