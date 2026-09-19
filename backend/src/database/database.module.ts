import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

@Injectable()
class DatabaseLifecycle implements OnModuleDestroy {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () =>
        new pg.Pool({
          connectionString: process.env.DATABASE_URL ?? 'postgresql://wms:wms@localhost:5432/wms',
          max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
          idleTimeoutMillis: 30_000,
          statement_timeout: 15_000,
        }),
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
