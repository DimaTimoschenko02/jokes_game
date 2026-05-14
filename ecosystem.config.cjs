const fs = require('fs')
const path = require('path')

function loadDotenv(filename) {
  const fullPath = path.join(__dirname, filename)
  if (!fs.existsSync(fullPath)) return {}
  const out = {}
  for (const line of fs.readFileSync(fullPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

const dotenv = loadDotenv('.env')

module.exports = {
  apps: [
    {
      name: 'punchme-api',
      script: 'dist/main.js',
      cwd: '/home/qwe/apps/punchme/api',
      exp_backoff_restart_delay: 1000,
      max_restarts: 50,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
        PORT: 4002,
        DATABASE_URL: 'postgres://punchme:punchme@127.0.0.1:5432/punchme',
        OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
        OLLAMA_EMBED_MODEL: 'bge-m3',
        PATH: '/home/qwe/.nvm/versions/node/v22.22.2/bin:/usr/local/bin:/usr/bin:/bin',
        ...dotenv
      }
    }
  ]
}
