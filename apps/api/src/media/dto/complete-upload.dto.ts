import { IsString, Matches, MaxLength } from 'class-validator';

export class CompleteUploadDto {
  @IsString()
  @MaxLength(512)
  @Matches(/^users\/[a-zA-Z0-9_-]+\/episodes\/[a-zA-Z0-9_-]+\/[a-f0-9-]+\.(mp3|m4a|aac|wav|ogg|webm|mp4|mov)$/i)
  objectKey!: string;
}