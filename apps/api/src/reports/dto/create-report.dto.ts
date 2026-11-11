import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateReportDto {
  @IsIn(['EPISODE', 'MOMENT', 'LIVE_ROOM', 'USER'])
  targetType!: 'EPISODE' | 'MOMENT' | 'LIVE_ROOM' | 'USER';

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  targetId!: string;

  @IsIn(['HARASSMENT', 'HATE', 'VIOLENCE', 'SEXUAL_CONTENT', 'SPAM', 'COPYRIGHT', 'SELF_HARM', 'OTHER'])
  reason!: 'HARASSMENT' | 'HATE' | 'VIOLENCE' | 'SEXUAL_CONTENT' | 'SPAM' | 'COPYRIGHT' | 'SELF_HARM' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}
