/**
 * API 에러.
 *
 * 내부 원인은 로그로만 남기고 응답 본문에는 절대 싣지 않는다.
 * SQL 에러 문구가 공개 API 로 새어나가면 스키마가 노출된다.
 */
export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable_entity'
  | 'too_many_requests'
  | 'internal_error';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options?: { fields?: Record<string, string>; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = options?.fields;
  }

  static badRequest(message: string, fields?: Record<string, string>) {
    return new ApiError(400, 'bad_request', message, { fields });
  }
  static unauthorized(message = '인증이 필요합니다.') {
    return new ApiError(401, 'unauthorized', message);
  }
  static forbidden(message = '권한이 없습니다.') {
    return new ApiError(403, 'forbidden', message);
  }
  static notFound(message = '찾을 수 없습니다.') {
    return new ApiError(404, 'not_found', message);
  }
  static conflict(message: string) {
    return new ApiError(409, 'conflict', message);
  }
  static unprocessable(message: string, fields?: Record<string, string>) {
    return new ApiError(422, 'unprocessable_entity', message, { fields });
  }
  static tooManyRequests(message = '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.') {
    return new ApiError(429, 'too_many_requests', message);
  }
  static internal(cause?: unknown) {
    return new ApiError(500, 'internal_error', '요청을 처리하지 못했습니다.', { cause });
  }
}
