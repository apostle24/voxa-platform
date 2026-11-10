import { IsIn, IsInt, Max, Min } from 'class-validator';

export class CreateUploadUrlDto {
  @IsIn(['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/webm', 'video/mp4', 'video/webm', 'video/quicktime'])
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(2147483648)
  sizeBytes!: number;
}