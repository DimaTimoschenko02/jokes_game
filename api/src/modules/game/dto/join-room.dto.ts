import { IsString, Length } from 'class-validator'

export class JoinRoomDto {
  @IsString()
  @Length(5, 5)
  public roomCode!: string
}
