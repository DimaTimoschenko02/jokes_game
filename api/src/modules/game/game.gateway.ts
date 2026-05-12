import { Logger, UsePipes, ValidationPipe } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { AuthService } from '../auth/auth.service'
import { UserRepository } from '../user/user.repository'
import { CastVoteDto } from './dto/cast-vote.dto'
import { CreateRoomDto } from './dto/create-room.dto'
import { JoinRoomDto } from './dto/join-room.dto'
import { StartGameDto } from './dto/start-game.dto'
import { SubmitAnswersDto } from './dto/submit-answers.dto'
import { SubmitOpeningFeedbackDto } from './dto/submit-feedback.dto'
import { SubmitRatingsDto } from './dto/submit-ratings.dto'
import { GameService } from './game.service'

type SocketData = {
  userId: string
  login: string
}

type SocketWithUser = Socket & { data: SocketData }

type SocketQueryPayload = {
  readonly roomCode?: string
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
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  private readonly logger: Logger = new Logger(GameGateway.name)

  @WebSocketServer()
  private readonly server!: Server

  public constructor(
    private readonly gameService: GameService,
    private readonly authService: AuthService,
    private readonly userRepository: UserRepository
  ) {
    this.gameService.setBroadcast((roomCode) => {
      void this.emitPersonalizedGameState(roomCode)
    })
  }

  public afterInit(server: Server): void {
    server.use((socket, next) => {
      const token: unknown = socket.handshake.auth?.token
      if (typeof token !== 'string' || !token) {
        next(new Error('Missing auth token'))
        return
      }
      try {
        const payload = this.authService.verifyToken(token)
        ;(socket.data as SocketData) = { userId: payload.sub, login: payload.login }
        next()
      } catch {
        next(new Error('Invalid auth token'))
      }
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

  public async handleConnection(client: SocketWithUser): Promise<void> {
    const query = client.handshake.query as SocketQueryPayload
    const roomCode: string | undefined = query.roomCode ? String(query.roomCode) : undefined
    const userId: string | undefined = client.data?.userId
    if (!roomCode || !userId) {
      return
    }
    try {
      this.gameService.reconnectPlayer({
        socketId: client.id,
        roomCode,
        playerId: userId
      })
      client.join(roomCode)
      const state = this.gameService.getStateForPlayer(roomCode, userId)
      client.emit('gameState', state)
    } catch (error: unknown) {
      this.logger.warn(
        `reconnect_failed socket=${client.id} room=${roomCode} user=${userId} error=${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  public handleDisconnect(client: Socket): void {
    this.gameService.handleDisconnect(client.id)
  }

  @SubscribeMessage('createRoom')
  public async createRoom(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: CreateRoomDto
  ): Promise<void> {
    const userProfile = await this.userRepository.findById(client.data.userId)
    if (!userProfile) {
      client.emit('authError', { code: 'USER_NOT_FOUND' })
      return
    }
    const session = await this.gameService.createRoom({
      socketId: client.id,
      host: userProfile,
      roundCount: body.roundCount,
      botCount: body.botCount
    })
    client.join(session.roomCode)
    client.emit('session', session)
    client.emit('gameState', this.gameService.getStateForPlayer(session.roomCode, session.playerId))
  }

  @SubscribeMessage('joinRoom')
  public async joinRoom(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: JoinRoomDto
  ): Promise<void> {
    const userProfile = await this.userRepository.findById(client.data.userId)
    if (!userProfile) {
      client.emit('authError', { code: 'USER_NOT_FOUND' })
      return
    }
    const session = this.gameService.joinRoom({
      socketId: client.id,
      roomCode: body.roomCode,
      user: userProfile
    })
    client.join(session.roomCode)
    client.emit('session', session)
    client.emit('gameState', this.gameService.getStateForPlayer(session.roomCode, session.playerId))
  }

  @SubscribeMessage('startGame')
  public async startGame(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: StartGameDto
  ): Promise<void> {
    const userId: string = client.data.userId
    await this.gameService.startGame({
      roomCode: body.roomCode,
      playerId: userId
    })
  }

  @SubscribeMessage('submitAnswers')
  public submitAnswers(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: SubmitAnswersDto
  ): void {
    this.gameService.submitAnswers({
      roomCode: body.roomCode,
      playerId: client.data.userId,
      answers: body.answers
    })
  }

  @SubscribeMessage('castVote')
  public castVote(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: CastVoteDto
  ): void {
    this.gameService.castVote({
      roomCode: body.roomCode,
      playerId: client.data.userId,
      duelId: body.duelId,
      side: body.side
    })
  }

  @SubscribeMessage('submitRatings')
  public submitRatings(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: SubmitRatingsDto
  ): void {
    this.gameService.submitRatings({
      roomCode: body.roomCode,
      playerId: client.data.userId,
      ratings: body.ratings
    })
  }

  @SubscribeMessage('submitOpeningFeedback')
  public submitOpeningFeedback(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: SubmitOpeningFeedbackDto
  ): void {
    this.gameService.submitOpeningFeedback({
      roomCode: body.roomCode,
      playerId: client.data.userId,
      items: body.items
    })
  }
}
