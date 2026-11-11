import { IsJWT, IsString } from 'class-validator';

export class MobileRefreshDto {
  @IsString() @IsJWT()
  refreshToken!: string;
}
