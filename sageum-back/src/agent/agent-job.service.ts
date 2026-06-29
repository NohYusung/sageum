import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { AgentJob } from './agent-job.entity';
import { AgentJobCallbackDto, CreateAgentJobDto } from './agent-job.dto';
import { SageumCliClient } from './sageum-cli.client';

@Injectable()
export class AgentJobService {
  constructor(
    @InjectRepository(AgentJob)
    private readonly jobs: Repository<AgentJob>,
    private readonly cli: SageumCliClient,
  ) {}

  async create(dto: CreateAgentJobDto) {
    const id = `job_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const callbackUrl = this.callbackUrl(id);
    const job = this.jobs.create({
      id,
      topic: dto.topic.trim(),
      level: dto.level ?? '입문',
      format: dto.format ?? '커리큘럼',
      status: 'queued',
      callbackUrl,
    });

    await this.jobs.save(job);

    try {
      job.status = 'submitted';
      job.submittedAt = new Date();
      await this.jobs.save(job);
      await this.cli.submitJob({
        jobId: id,
        topic: job.topic,
        callbackUrl,
        forceRefresh: dto.forceRefresh,
      });
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Sageum agent submit failed';
      job.completedAt = new Date();
      await this.jobs.save(job);
    }

    return this.findOne(id);
  }

  async findOne(id: string) {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Agent job not found: ${id}`);
    }
    return job;
  }

  async list() {
    return this.jobs.find({
      order: {
        createdAt: 'DESC',
      },
      take: 50,
    });
  }

  async callback(id: string, dto: AgentJobCallbackDto) {
    if (dto.jobId && dto.jobId !== id) {
      throw new BadRequestException('callback jobId does not match route jobId');
    }

    const job = await this.findOne(id);
    job.status = dto.status;
    job.completedAt = new Date();
    job.markdown = dto.markdown ?? job.markdown;
    job.html = dto.html ?? job.html;
    job.sources = dto.sources ?? job.sources;
    job.search = dto.search ?? job.search;
    job.extract = dto.extract ?? job.extract;
    job.rawResult = dto.rawResult ?? job.rawResult;
    job.cacheHit = dto.cacheHit ?? job.cacheHit;
    job.error = dto.error ?? null;

    if (dto.status === 'completed' && !job.markdown && !job.html) {
      throw new BadRequestException('completed callback requires markdown or html');
    }

    return this.jobs.save(job);
  }

  private callbackUrl(id: string) {
    const port = process.env.SAGEUM_BACK_PORT ?? process.env.PORT ?? '4000';
    const base = process.env.SAGEUM_BACKEND_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
    return new URL(`/agent/jobs/${id}/callback`, base).toString();
  }
}
