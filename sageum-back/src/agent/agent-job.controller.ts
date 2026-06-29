import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AgentJobCallbackDto, CreateAgentJobDto } from './agent-job.dto';
import { AgentJobService } from './agent-job.service';

@Controller('agent/jobs')
export class AgentJobController {
  constructor(private readonly jobs: AgentJobService) {}

  @Post()
  create(@Body() dto: CreateAgentJobDto) {
    return this.jobs.create(dto);
  }

  @Get()
  list() {
    return this.jobs.list();
  }

  @Get(':jobId')
  findOne(@Param('jobId') jobId: string) {
    return this.jobs.findOne(jobId);
  }

  @Post(':jobId/callback')
  callback(@Param('jobId') jobId: string, @Body() dto: AgentJobCallbackDto) {
    return this.jobs.callback(jobId, dto);
  }
}
