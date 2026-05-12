import { ArrayMaxSize, IsArray, IsIn, IsInt, IsString, Length, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class OpeningFeedbackItemDto {
  @IsInt()
  @Min(0)
  public promptIndex!: number

  @IsString()
  @IsIn(['up', 'down', 'broken'])
  public verdict!: 'up' | 'down' | 'broken'
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
