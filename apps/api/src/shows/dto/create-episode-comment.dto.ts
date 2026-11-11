import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateEpisodeCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string;
}
