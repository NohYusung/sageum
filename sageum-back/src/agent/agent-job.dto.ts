import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateAgentJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  topic!: string;

  @IsString()
  @IsOptional()
  @MaxLength(24)
  level?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  format?: string;

  @IsBoolean()
  @IsOptional()
  forceRefresh?: boolean;
}

export class AgentJobCallbackDto {
  @IsString()
  @IsOptional()
  jobId?: string;

  @IsIn(['completed', 'failed'])
  status!: 'completed' | 'failed';

  @IsString()
  @IsOptional()
  markdown?: string;

  @IsString()
  @IsOptional()
  html?: string;

  @IsArray()
  @IsOptional()
  sources?: Array<Record<string, unknown>>;

  @IsObject()
  @IsOptional()
  search?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  extract?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  rawResult?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  cacheHit?: boolean;

  @IsString()
  @IsOptional()
  error?: string;
}
