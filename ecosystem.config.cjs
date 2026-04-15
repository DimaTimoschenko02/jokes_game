module.exports = {
  apps: [
    {
      name: 'punchme-api',
      script: 'api/dist/main.js',
      cwd: '/home/qwe/apps/punchme',
      exp_backoff_restart_delay: 1000,
      max_restarts: 50,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
        PORT: 4002,
        MONGO_URI: 'mongodb://127.0.0.1:27017/punchme',
        OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
        OLLAMA_EMBED_MODEL: 'bge-m3',
      },
    },
  ],
};
