import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAccountProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;
}
