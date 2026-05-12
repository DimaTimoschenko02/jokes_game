export type JwtPayload = {
  readonly sub: string
  readonly login: string
}

export type AuthenticatedUser = {
  readonly id: string
  readonly login: string
}
