import { IsInt, IsString, Max, Min } from 'class-validator'

export class RatingScoreDto {
  @IsString()
  public itemId!: string

  @IsInt()
  @Min(1)
  @Max(10)
  public score!: number
}
