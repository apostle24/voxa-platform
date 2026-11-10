import { IsIn, IsString, Length, Matches } from 'class-validator';

export class CreatePayoutDestinationDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsIn(['ghipss', 'mobile_money'])
  type!: 'ghipss' | 'mobile_money';

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,30}$/)
  bankCode!: string;

  @IsString()
  @Matches(/^[0-9+]{6,20}$/)
  accountNumber!: string;
}
