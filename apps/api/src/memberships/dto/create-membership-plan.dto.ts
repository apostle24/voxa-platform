import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class CreateMembershipPlanDto {
  @IsString()
  @Length(2, 40)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;

  @IsInt()
  @Min(1)
  @Max(100000000)
  priceMinor!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}
