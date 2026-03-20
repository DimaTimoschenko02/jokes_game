import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator'
import { ANSWER_MAX_LENGTH } from '../constants/game.constants'

export class SubmitAnswersDto {
  @IsString()
  @MinLength(5)
  @MaxLength(5)
  public roomCode!: string

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @MaxLength(ANSWER_MAX_LENGTH, { each: true })
  public answers!: [string, string]
}
