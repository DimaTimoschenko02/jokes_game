import { IsString, Length } from 'class-validator'

export class LeaveRoomDto {
  @IsString()
  @Length(5, 5)
  public roomCode!: string
}
