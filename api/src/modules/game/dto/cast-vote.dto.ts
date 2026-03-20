import { IsIn, IsString, Length } from 'class-validator'

export class CastVoteDto {
  @IsString()
  @Length(5, 5)
  public roomCode!: string

  @IsString()
  public duelId!: string

  @IsString()
  @IsIn(['left', 'right'])
  public side!: 'left' | 'right'
}
