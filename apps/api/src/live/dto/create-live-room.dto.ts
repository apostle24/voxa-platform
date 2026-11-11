import { IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength, IsDateString } from 'class-validator';

export class CreateLiveRoomDto {
  @IsString()
  @Length(3, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isAudioOnly?: boolean;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsIn(['PUBLIC', 'UNLISTED', 'MEMBERS_ONLY', 'PRIVATE'])
  visibility?: 'PUBLIC' | 'UNLISTED' | 'MEMBERS_ONLY' | 'PRIVATE';
}
