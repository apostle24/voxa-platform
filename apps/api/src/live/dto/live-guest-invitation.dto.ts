import { IsISO8601, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateLiveGuestInvitationDto {
  @IsString()
  @Length(1, 100)
  userId!: string;

  @IsISO8601()
  slotStartsAt!: string;

  @IsISO8601()
  slotEndsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class RespondLiveGuestInvitationDto {
  @IsString()
  @Length(1, 10)
  decision!: 'ACCEPTED' | 'DECLINED';
}
