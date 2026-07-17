import { IsString, MaxLength, MinLength } from 'class-validator'
import { OPENING_MAX_LENGTH, OPENING_MIN_LENGTH } from '../constants/game.constants'

export class SubmitOpeningDto {
  @IsString()
  @MinLength(5)
  @MaxLength(5)
  public roomCode!: string

  @IsString()
  @MinLength(OPENING_MIN_LENGTH)
  @MaxLength(OPENING_MAX_LENGTH)
  public text!: string
}
