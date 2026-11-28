export class TeachingDataError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'TeachingDataError';
  }
}

export class TokenInvalidError extends Error {
  constructor() {
    super('Token invalid');
    this.name = 'TokenInvalidError';
  }
}

export function asTeachingDataError(error: unknown, fallback = '上游教学平台暂时不可用，请稍后重试。'): TeachingDataError {
  if (error instanceof TeachingDataError) return error;
  if (error instanceof TokenInvalidError) {
    return new TeachingDataError(422, 'Token 已过期或无效，请重新登录获取。', 'token_invalid');
  }
  // 上游异常可能包含 SQL、堆栈或带凭据 URL；只返回固定的公共消息。
  return new TeachingDataError(502, fallback, 'upstream_error');
}
