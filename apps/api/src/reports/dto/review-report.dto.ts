import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ReviewReportDto {
  @IsIn(['REVIEWING', 'ACTIONED', 'DISMISSED'])
  status!: 'REVIEWING' | 'ACTIONED' | 'DISMISSED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  moderatorNote?: string;
}


export class ModerationActionDto {
  @IsIn(['HIDE_EPISODE', 'RESTORE_EPISODE', 'HIDE_MOMENT', 'RESTORE_MOMENT', 'WARN_USER', 'SUSPEND_USER', 'REINSTATE_USER'])
  action!: 'HIDE_EPISODE' | 'RESTORE_EPISODE' | 'HIDE_MOMENT' | 'RESTORE_MOMENT' | 'WARN_USER' | 'SUSPEND_USER' | 'REINSTATE_USER';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  suspensionDays?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  moderatorNote!: string;
}
