const CLAUDE_ERROR_PATTERNS: readonly RegExp[] = [
  /API Error:\s*4\d{2}/i,
  /Failed to authenticate/i,
  /authentication_error/i,
  /Invalid authentication/i,
  /rate_limit_error/i,
  /OAuth token has expired/i,
  /Please run.*login/i,
  /^Error:\s/
]

export const detectClaudeOutputError = (text: string): string | null => {
  if (typeof text !== 'string' || text.length === 0) {
    return null
  }
  for (const pattern of CLAUDE_ERROR_PATTERNS) {
    if (pattern.test(text)) {
      return text.slice(0, 160)
    }
  }
  return null
}
