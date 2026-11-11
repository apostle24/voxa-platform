import { IsString, Length } from 'class-validator';
export class MfaVerifyDto {
  @IsString()
  @Length(32, 256)
  token!: string;
  @IsString()
  @Length(6, 20)
  code!: string;
}
