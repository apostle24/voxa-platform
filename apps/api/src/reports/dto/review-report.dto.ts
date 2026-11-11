import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewReportDto {
  @IsIn(['REVIEWING', 'ACTIONED', 'DISMISSED'])
  status!: 'REVIEWING' | 'ACTIONED' | 'DISMISSED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  moderatorNote?: string;
}


export class ModerationActionDto {
  @IsIn(['HIDE_EPISODE', 'RESTORE_EPISODE', 'HIDE_MOMENT', 'RESTORE_MOMENT'])
  action!: 'HIDE_EPISODE' | 'RESTORE_EPISODE' | 'HIDE_MOMENT' | 'RESTORE_MOMENT';

  @IsString()
  @MaxLength(1000)
  moderatorNote!: string;
}
