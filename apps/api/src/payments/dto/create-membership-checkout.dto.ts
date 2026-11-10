import { IsString, Length } from 'class-validator';

export class CreateMembershipCheckoutDto {
  @IsString()
  @Length(1, 100)
  planId!: string;
}
