import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateEpisodeDto {
  @IsString() @MinLength(2) @MaxLength(160)
  title!: string;

  @IsOptional() @IsString() @MaxLength(8000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(512)
  mediaKey?: string;

  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(2048)
  artworkUrl?: string;

  @IsOptional() @IsInt() @Min(1) @Max(43200)
  durationSeconds?: number;

  @IsOptional() @IsBoolean()
  isExplicit?: boolean;
}