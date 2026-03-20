const http = require('http')

const request = http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
  let body = ''
  res.on('data', (chunk) => {
    body += chunk.toString()
  })
  res.on('end', () => {
    try {
      const json = JSON.parse(body)
      const url = json?.tunnels?.[0]?.public_url
      if (!url) {
        console.error('Ngrok is running but no public_url found.')
        process.exit(1)
      }
      console.log(url)
    } catch (error) {
      console.error('Failed to parse ngrok response.')
      process.exit(1)
    }
  })
})

request.on('error', () => {
  console.error('Ngrok is not running on http://127.0.0.1:4040')
  process.exit(1)
})
