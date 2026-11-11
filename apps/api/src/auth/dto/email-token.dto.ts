import { IsString, Length } from 'class-validator';

export class EmailTokenDto {
  @IsString()
  @Length(32, 256)
  token!: string;
}
