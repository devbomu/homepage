/**
 * Worker 바인딩과 요청 컨텍스트 타입.
 *
 * vars 는 wrangler.jsonc 에, 비밀값은 `wrangler secret put` 으로 주입한다.
 * 공개 저장소이므로 비밀값은 어떤 경우에도 설정 파일에 들어가지 않는다.
 */

/** Workers 네이티브 레이트리밋 바인딩. 엣지에서 카운트해 D1 쓰기가 발생하지 않는다. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Bindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  RATE_LIMIT_WRITE: RateLimiter;
  RATE_LIMIT_COMMENT: RateLimiter;

  // --- wrangler.jsonc 의 vars (비밀 아님) ---
  ENVIRONMENT: string;
  SITE_URL: string;
  ADMIN_URL: string;
  MEDIA_PUBLIC_BASE_URL: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  COMMENTS_REQUIRE_APPROVAL: string;
  /** 관리자 답글에 표시할 이름. 비우면 '작성자'. */
  OWNER_DISPLAY_NAME?: string;
  /** 추가 허용 오리진 (쉼표 구분). 보통 비어 있다. */
  ALLOWED_ORIGINS?: string;

  // --- wrangler secret (비밀) ---
  VISITOR_HASH_SALT: string;
  TURNSTILE_SECRET_KEY: string;
  ADMIN_EMAILS: string;
}

/** Cloudflare Access 가 검증한 관리자 신원. */
export interface AdminIdentity {
  /** 사람이 로그인한 경우의 이메일. */
  email: string;
  /** 서비스 토큰(기계 간 호출)인 경우의 이름. */
  commonName: string;
  subject: string;
}

/** 감사 로그에 남길 식별자. */
export function actorOf(identity: AdminIdentity): string {
  if (identity.email) return identity.email;
  if (identity.commonName) return `service:${identity.commonName}`;
  return 'unknown';
}

export interface Variables {
  identity: AdminIdentity;
  /** sha256(ip + user-agent + 솔트). 원본 IP 는 저장하지 않는다. */
  visitorHash: string;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };

export function isDevelopment(env: Bindings): boolean {
  return env.ENVIRONMENT !== 'production';
}

export function commentsRequireApproval(env: Bindings): boolean {
  return env.COMMENTS_REQUIRE_APPROVAL !== 'false';
}

/** 쉼표로 구분된 환경변수를 배열로. */
export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
