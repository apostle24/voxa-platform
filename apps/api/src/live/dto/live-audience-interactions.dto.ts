import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateLivePollDto {
  @IsString()
  @Length(5, 240)
  question!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  options!: string[];
}

export class VoteLivePollDto {
  @IsString()
  @Length(1, 100)
  optionId!: string;
}

export class CreateLiveQuestionDto {
  @IsString()
  @Length(5, 500)
  question!: string;
}

export class ModerateLiveQuestionDto {
  @IsOptional()
  @IsString()
  @Length(1, 20)
  status?: 'APPROVED' | 'REJECTED' | 'CLOSED';

  @IsOptional()
  pinned?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  answer?: string;
}
