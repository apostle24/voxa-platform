import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export class CreateLiveAgendaItemDto {
  @IsString()
  @Length(2, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsInt()
  @Min(1)
  @Max(14400)
  durationSeconds!: number;
}

export class UpdateLiveAgendaItemDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14400)
  durationSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  position?: number;
}

export class HandoffLiveSpeakerDto {
  @IsString()
  @Length(1, 100)
  speakerId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  agendaItemId?: string;
}
