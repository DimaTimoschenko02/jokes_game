import { IsArray, IsString, Length, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { RatingScoreDto } from './rating-score.dto'

export class SubmitRatingsDto {
  @IsString()
  @Length(5, 5)
  public roomCode!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RatingScoreDto)
  public ratings!: RatingScoreDto[]
}
