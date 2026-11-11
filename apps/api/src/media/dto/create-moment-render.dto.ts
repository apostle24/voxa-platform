import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMomentRenderDto {
  @IsIn(['9:16', '16:9'])
  aspectRatio!: '9:16' | '16:9';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  subtitles?: string;
}
