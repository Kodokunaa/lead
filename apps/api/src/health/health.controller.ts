import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Sql } from 'postgres';
import { SQL_CLIENT } from '../database/database.module';

export interface HealthStatus {
  readonly status: 'ok';
  readonly database: 'up';
}

@Controller('health')
export class HealthController {
  constructor(@Inject(SQL_CLIENT) private readonly sql: Sql) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.sql`select 1`;
    } catch {
      // Do not leak connection details to callers.
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return { status: 'ok', database: 'up' };
  }
}
