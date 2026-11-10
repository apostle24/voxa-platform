import { IsOptional, IsString, MaxLength, MinLength, IsUrl } from 'class-validator';

export class CreateShowDto {
  @IsString() @MinLength(2) @MaxLength(120)
  title!: string;

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(12)
  language?: string;

  @IsOptional() @IsString() @MaxLength(80)
  category?: string;

  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(2048)
  artworkUrl?: string;
}