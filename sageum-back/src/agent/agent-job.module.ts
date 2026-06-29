import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentJobController } from './agent-job.controller';
import { AgentJob } from './agent-job.entity';
import { AgentJobService } from './agent-job.service';
import { SageumCliClient } from './sageum-cli.client';

@Module({
  imports: [TypeOrmModule.forFeature([AgentJob])],
  controllers: [AgentJobController],
  providers: [AgentJobService, SageumCliClient],
})
export class AgentJobModule {}
