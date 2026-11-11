import { IsString, Length, Matches } from 'class-validator';

export class PasswordResetDto {
  @IsString()
  @Length(32, 256)
  token!: string;

  @IsString()
  @Length(10, 72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).+$/, {
    message: 'Password must include lowercase, uppercase, and a number',
  })
  password!: string;
}
