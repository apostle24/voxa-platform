import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(2, 60)
  displayName!: string;

  @IsString()
  @Length(10, 72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must include lowercase, uppercase, and a number',
  })
  password!: string;

  @IsString()
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Handle may contain letters, numbers, and underscores only',
  })
  handle!: string;
}
