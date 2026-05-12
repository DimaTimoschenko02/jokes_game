import { IsInt, Max, Min } from 'class-validator'
import {
  BOT_COUNT_MAX,
  BOT_COUNT_MIN,
  ROUND_COUNT_MAX,
  ROUND_COUNT_MIN
} from '../constants/game.constants'

export class CreateRoomDto {
  @IsInt()
  @Min(ROUND_COUNT_MIN)
  @Max(ROUND_COUNT_MAX)
  public roundCount!: number

  @IsInt()
  @Min(BOT_COUNT_MIN)
  @Max(BOT_COUNT_MAX)
  public botCount!: number
}
