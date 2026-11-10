import { IsInt, IsString, Length, Min } from 'class-validator';

export class CreatePayoutRequestDto {
  @IsString()
  @Length(1, 100)
  destinationId!: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;
}
