import { io } from 'socket.io-client'

const WEB_URL = 'http://localhost:5173'

console.log(`Connecting to ${WEB_URL} (going through vite proxy to api)...`)

const socket = io(WEB_URL, { transports: ['websocket'], forceNew: true })

const timeout = setTimeout(() => {
  console.error('FAIL: no response in 15s')
  process.exit(1)
}, 15000)

socket.on('connect', () => {
  console.log('CONNECTED via proxy, socket.id =', socket.id)
  console.log('Emitting createRoom...')
  socket.emit('createRoom', { name: 'ProxyTest', roundCount: 3, botCount: 1 })
})

socket.on('connect_error', (err) => {
  console.error('CONNECT ERROR:', err.message)
  clearTimeout(timeout)
  process.exit(1)
})

socket.on('session', (s) => {
  console.log('SESSION received:', s)
})

socket.on('gameState', (state: { phase: string; roomCode: string; players: { name: string; isHost: boolean }[] }) => {
  console.log(`gameState: phase=${state.phase} room=${state.roomCode} players=${state.players.map((p) => p.name).join(',')}`)
  if (state.phase === 'lobby' && state.players.find((p) => p.isHost)) {
    console.log('Emitting startGame...')
    socket.emit('startGame', { roomCode: state.roomCode })
    setTimeout(() => {
      console.log('DONE — if game transitioned from lobby, startGame works')
      clearTimeout(timeout)
      socket.disconnect()
      process.exit(0)
    }, 5000)
  }
})

socket.on('exception', (err) => {
  console.error('EXCEPTION:', err)
})
