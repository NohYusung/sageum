import assert from 'node:assert/strict';
import { AgentJobService } from '../src/agent/agent-job.service';

type Job = Record<string, any>;

class MemoryRepository {
  rows = new Map<string, Job>();

  create(payload: Job) {
    return { ...payload };
  }

  async save(job: Job) {
    this.rows.set(job.id, { ...job });
    return job;
  }

  async findOne(options: {
    where: Partial<Job>;
    order?: Record<string, 'ASC' | 'DESC'>;
  }) {
    const rows = [...this.rows.values()].filter((row) =>
      Object.entries(options.where).every(([key, value]) => row[key] === value),
    );
    if (options.order?.completedAt === 'DESC') {
      rows.sort((left, right) => Number(right.completedAt ?? 0) - Number(left.completedAt ?? 0));
    }
    return rows[0] ?? null;
  }

  async find() {
    return [...this.rows.values()];
  }
}

class FakeCli {
  submitted: Job[] = [];

  async submitJob(payload: Job) {
    this.submitted.push(payload);
    return { status: 'accepted' };
  }
}

async function main() {
  const repository = new MemoryRepository();
  const cli = new FakeCli();
  const service = new AgentJobService(repository as any, cli as any);

  const created = await service.create({
    topic: '리그오브레전드 정글 잘하는 방법',
    level: '입문',
    format: '커리큘럼',
  });

  assert.equal(created.status, 'running');
  assert.equal(cli.submitted.length, 1);
  assert.equal(cli.submitted[0].topic, '리그오브레전드 정글 잘하는 방법');
  assert.ok(created.submittedAt instanceof Date);

  const completed = await service.callback(created.id, {
    jobId: created.id,
    status: 'completed',
    markdown: '# 리그오브레전드 정글 잘하는 방법\n',
    html: '<article></article>',
    concepts: [{ id: 'concept_lane_priority', name: '라인 주도권' }],
    mentions: [{ text: '라인 주도권', concept_id: 'concept_lane_priority' }],
    relations: [
      {
        relation_id: 'rel_lane_priority_objective',
        source: 'concept_lane_priority',
        relation_type: 'enables',
        target: 'concept_objective_control',
      },
    ],
    sourceLinks: [{ title: 'Riot', url: 'https://www.leagueoflegends.com/' }],
    suggestedFilename: '리그오브레전드 정글 잘하는 방법.md',
    obsidianFrontmatter: { status: 'generated' },
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.markdown, '# 리그오브레전드 정글 잘하는 방법\n');
  assert.equal(completed.semanticMetadata?.suggestedFilename, '리그오브레전드 정글 잘하는 방법.md');
  assert.deepEqual(completed.semanticMetadata?.obsidianFrontmatter, { status: 'generated' });
  assert.equal((completed.semanticMetadata?.concepts as Array<Record<string, unknown>>)[0].name, '라인 주도권');
  assert.equal((completed.semanticMetadata?.relations as Array<Record<string, unknown>>)[0].relation_id, 'rel_lane_priority_objective');

  const duplicate = await service.create({
    topic: '  리그오브레전드 정글 잘하는 방법  ',
    level: '입문',
    format: '커리큘럼',
  });

  assert.equal(duplicate.id, created.id);
  assert.equal(duplicate.status, 'completed');
  assert.equal(duplicate.cacheHit, true);
  assert.equal(cli.submitted.length, 1);

  const refreshed = await service.create({
    topic: '리그오브레전드 정글 잘하는 방법',
    level: '입문',
    format: '커리큘럼',
    forceRefresh: true,
  });

  assert.notEqual(refreshed.id, created.id);
  assert.equal(refreshed.status, 'running');
  assert.equal(cli.submitted.length, 2);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
