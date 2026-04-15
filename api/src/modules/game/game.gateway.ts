import { UsePipes, ValidationPipe } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { CastVoteDto } from './dto/cast-vote.dto'
import { CreateRoomDto } from './dto/create-room.dto'
import { JoinRoomDto } from './dto/join-room.dto'
import { StartGameDto } from './dto/start-game.dto'
import { SubmitAnswersDto } from './dto/submit-answers.dto'
import { SubmitRatingsDto } from './dto/submit-ratings.dto'
import { GameService } from './game.service'

type SocketQueryPayload = {
  readonly roomCode?: string
  readonly playerId?: string
}

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true
  }
})
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true
  })
)
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server

  public constructor(private readonly gameService: GameService) {
    this.gameService.setBroadcast((roomCode) => {
      void this.emitPersonalizedGameState(roomCode)
    })
  }

  private async emitPersonalizedGameState(roomCode: string): Promise<void> {
    const sockets = await this.server.in(roomCode).fetchSockets()
    for (const socket of sockets) {
      const session = this.gameService.getSessionBySocket(socket.id)
      if (!session) {
        continue
      }
      socket.emit('gameState', this.gameService.getStateForPlayer(roomCode, session.playerId))
    }
  }

  public handleConnection(client: Socket): void {
    const query = client.handshake.query as SocketQueryPayload
    if (!query.roomCode || !query.playerId) {
      return
    }
    try {
      this.gameService.reconnectPlayer({
        socketId: client.id,
        roomCode: String(query.roomCode),
        playerId: String(query.playerId)
      })
      client.join(String(query.roomCode))
      const state = this.gameService.getStateForPlayer(String(query.roomCode), String(query.playerId))
      client.emit('gameState', state)
    } catch {}
  }

  public handleDisconnect(client: Socket): void {
    this.gameService.handleDisconnect(client.id)
  }

  @SubscribeMessage('createRoom')
  public async createRoom(@ConnectedSocket() client: Socket, @MessageBody() body: CreateRoomDto): Promise<void> {
    const session = await this.gameService.createRoom({
      socketId: client.id,
      name: body.name,
      roundCount: body.roundCount,
      botCount: body.botCount,
      bio: body.bio
    })
    client.join(session.roomCode)
    client.emit('session', session)
    client.emit('gameState', this.gameService.getStateForPlayer(session.roomCode, session.playerId))
  }

  @SubscribeMessage('joinRoom')
  public joinRoom(@ConnectedSocket() client: Socket, @MessageBody() body: JoinRoomDto): void {
    const session = this.gameService.joinRoom({
      socketId: client.id,
      roomCode: body.roomCode,
      name: body.name,
      bio: body.bio
    })
    client.join(session.roomCode)
    client.emit('session', session)
    client.emit('gameState', this.gameService.getStateForPlayer(session.roomCode, session.playerId))
  }

  @SubscribeMessage('startGame')
  public async startGame(@ConnectedSocket() client: Socket, @MessageBody() body: StartGameDto): Promise<void> {
    const session = this.gameService.getSessionBySocket(client.id)
    if (!session || session.roomCode !== body.roomCode) {
      return
    }
    await this.gameService.startGame({
      roomCode: body.roomCode,
      playerId: session.playerId
    })
  }

  @SubscribeMessage('submitAnswers')
  public submitAnswers(@ConnectedSocket() client: Socket, @MessageBody() body: SubmitAnswersDto): void {
    const session = this.gameService.getSessionBySocket(client.id)
    if (!session || session.roomCode !== body.roomCode) {
      return
    }
    this.gameService.submitAnswers({
      roomCode: body.roomCode,
      playerId: session.playerId,
      answers: body.answers
    })
  }

  @SubscribeMessage('castVote')
  public castVote(@ConnectedSocket() client: Socket, @MessageBody() body: CastVoteDto): void {
    const session = this.gameService.getSessionBySocket(client.id)
    if (!session || session.roomCode !== body.roomCode) {
      return
    }
    this.gameService.castVote({
      roomCode: body.roomCode,
      playerId: session.playerId,
      duelId: body.duelId,
      side: body.side
    })
  }

  @SubscribeMessage('submitRatings')
  public submitRatings(@ConnectedSocket() client: Socket, @MessageBody() body: SubmitRatingsDto): void {
    const session = this.gameService.getSessionBySocket(client.id)
    if (!session || session.roomCode !== body.roomCode) {
      return
    }
    this.gameService.submitRatings({
      roomCode: body.roomCode,
      playerId: session.playerId,
      ratings: body.ratings
    })
  }
}
