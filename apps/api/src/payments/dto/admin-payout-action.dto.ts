import { IsString, MaxLength, MinLength } from 'class-validator';

export class AdminPayoutActionDto {
  @IsString()
  @MinLength(6)
  @MaxLength(500)
  reason!: string;
}
