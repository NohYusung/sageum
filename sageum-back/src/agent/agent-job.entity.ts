import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AgentJobStatus = 'queued' | 'submitted' | 'running' | 'completed' | 'failed';

@Entity({ name: 'agent_jobs' })
export class AgentJob {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  id!: string;

  @Column({ type: 'varchar', length: 220 })
  topic!: string;

  @Column({ type: 'varchar', length: 24, default: '입문' })
  level!: string;

  @Column({ type: 'varchar', length: 32, default: '커리큘럼' })
  format!: string;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status!: AgentJobStatus;

  @Column({ type: 'text', nullable: true })
  callbackUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  markdown!: string | null;

  @Column({ type: 'text', nullable: true })
  html!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  sources!: Array<Record<string, unknown>> | null;

  @Column({ type: 'simple-json', nullable: true })
  search!: Record<string, unknown> | null;

  @Column({ type: 'simple-json', nullable: true })
  extract!: Record<string, unknown> | null;

  @Column({ type: 'simple-json', nullable: true })
  rawResult!: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  cacheHit!: boolean;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'datetime', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
