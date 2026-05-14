import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator'

export class CastVoteDto {
  @IsString()
  @Length(5, 5)
  public roomCode!: string

  @IsString()
  public duelId!: string

  @IsString()
  @IsIn(['left', 'right'])
  public side!: 'left' | 'right'

  @IsOptional()
  @IsBoolean()
  public golden?: boolean
}
