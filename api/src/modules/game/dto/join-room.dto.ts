import { IsOptional, IsString, Length, MaxLength } from 'class-validator'
import { PLAYER_NAME_MAX_LENGTH } from '../constants/game.constants'

export class JoinRoomDto {
  @IsString()
  @Length(5, 5)
  public roomCode!: string

  @IsString()
  @MaxLength(PLAYER_NAME_MAX_LENGTH)
  public name!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  public bio?: string
}
