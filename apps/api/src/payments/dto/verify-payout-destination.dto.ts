import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyPayoutDestinationDto {
  @IsString()
  @IsIn(['PROVIDER_CONFIRMATION', 'MICRO_DEPOSIT', 'MANUAL_DOCUMENT_REVIEW', 'CALLBACK_VERIFICATION'])
  verificationMethod!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(120)
  verificationReference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
