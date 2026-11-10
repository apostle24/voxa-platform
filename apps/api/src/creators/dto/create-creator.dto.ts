import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CreateCreatorDto {
  @IsString()
  @Length(3, 30)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Handle may contain letters, numbers, and underscores only',
  })
  handle!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}
