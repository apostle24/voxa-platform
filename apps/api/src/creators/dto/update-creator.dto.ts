import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCreatorDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}