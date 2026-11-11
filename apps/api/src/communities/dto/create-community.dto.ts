import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCommunityDto {
  @IsString() @MinLength(3) @MaxLength(80)
  name!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(60)
  category?: string;

  @IsOptional() @IsString() @MaxLength(2048)
  artworkUrl?: string;
}