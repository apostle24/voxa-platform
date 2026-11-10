import { IsBoolean } from 'class-validator';

export class SetEpisodeMembershipDto {
  @IsBoolean()
  membershipRequired!: boolean;
}
