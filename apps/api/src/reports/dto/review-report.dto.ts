import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewReportDto {
  @IsIn(['REVIEWING', 'ACTIONED', 'DISMISSED'])
  status!: 'REVIEWING' | 'ACTIONED' | 'DISMISSED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  moderatorNote?: string;
}
