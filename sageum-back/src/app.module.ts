import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AgentJobModule } from './agent/agent-job.module';
import { HealthController } from './health.controller';

function databasePath() {
  const configured = process.env.SAGEUM_BACK_DB_PATH ?? '../data/sageum-back.sqlite';
  const resolved = resolve(process.cwd(), configured);
  mkdirSync(dirname(resolved), { recursive: true });
  return resolved;
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: databasePath(),
      autoLoadEntities: true,
      synchronize: process.env.SAGEUM_BACK_DB_SYNC !== 'false',
    }),
    AgentJobModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
