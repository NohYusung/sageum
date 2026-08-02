import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SaveDocumentOptionsDto {
  @IsBoolean()
  @IsOptional()
  createConceptNotes?: boolean;

  @IsBoolean()
  @IsOptional()
  overwrite?: boolean;

  @IsString()
  @IsOptional()
  targetFolder?: string;
}

export class SaveDocumentDto {
  @IsString()
  @IsOptional()
  jobId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  title!: string;

  @IsString()
  @IsNotEmpty()
  markdown!: string;

  @IsArray()
  @IsOptional()
  concepts?: Array<Record<string, unknown>>;

  @IsArray()
  @IsOptional()
  mentions?: Array<Record<string, unknown>>;

  @IsArray()
  @IsOptional()
  relations?: Array<Record<string, unknown>>;

  @IsArray()
  @IsOptional()
  sources?: Array<Record<string, unknown>>;

  @IsObject()
  @IsOptional()
  options?: SaveDocumentOptionsDto;
}
