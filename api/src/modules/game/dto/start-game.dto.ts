import { IsString, Length } from 'class-validator'

export class StartGameDto {
  @IsString()
  @Length(5, 5)
  public roomCode!: string
}
