import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import {
  BOT_COUNT_MAX,
  BOT_COUNT_MIN,
  PLAYER_NAME_MAX_LENGTH,
  ROUND_COUNT_MAX,
  ROUND_COUNT_MIN
} from '../constants/game.constants'

export class CreateRoomDto {
  @IsString()
  @MaxLength(PLAYER_NAME_MAX_LENGTH)
  public name!: string

  @IsInt()
  @Min(ROUND_COUNT_MIN)
  @Max(ROUND_COUNT_MAX)
  public roundCount!: number

  @IsInt()
  @Min(BOT_COUNT_MIN)
  @Max(BOT_COUNT_MAX)
  public botCount!: number

  @IsOptional()
  @IsString()
  @MaxLength(200)
  public bio?: string
}
