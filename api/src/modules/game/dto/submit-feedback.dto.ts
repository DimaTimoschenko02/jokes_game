import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsString, Length, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class OpeningFeedbackItemDto {
  @IsInt()
  @Min(0)
  public promptIndex!: number

  @IsNumber()
  @IsIn([-1, -0.5, 0.5, 1])
  public level!: number
}

export class SubmitOpeningFeedbackDto {
  @IsString()
  @Length(5, 5)
  public roomCode!: string

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OpeningFeedbackItemDto)
  public items!: readonly OpeningFeedbackItemDto[]
}
