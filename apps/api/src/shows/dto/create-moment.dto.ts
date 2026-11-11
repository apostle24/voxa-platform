import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateMomentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  caption!: string;

  @IsInt()
  @Min(0)
  startSeconds!: number;

  @IsInt()
  @Min(1)
  endSeconds!: number;
}
