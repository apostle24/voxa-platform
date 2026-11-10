import { IsInt, Max, Min } from 'class-validator';

export class SaveProgressDto {
  @IsInt()
  @Min(0)
  @Max(43200)
  positionSeconds!: number;
}