import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SearchVaultDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q!: string;
}
