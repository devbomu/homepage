import { ApiError } from './errors';

/**
 * 방문자 식별 해시.
 *
 * 좋아요 중복 차단과 레이트리밋에 안정적인 식별자가 필요하지만,
 * 그 목적에 IP 원문이 필요하지는 않다. 따라서 해시만 만들어 쓰고
 * 원본은 저장하지도, 로그에 남기지도 않는다.
 *
 * 솔트가 바뀌면 기존 해시와 매칭되지 않는다 (= 모든 좋아요가 익명 신규로 보인다).
 * 솔트는 한 번 정하면 바꾸지 않는다.
 */
export async function computeVisitorHash(
  ip: string,
  userAgent: string,
  salt: string,
): Promise<string> {
  if (!salt || salt.length < 32) {
    // 솔트 없이 해시를 만들면 IP 를 되맞추는 것이 쉬워진다 (IPv4 공간은 작다).
    throw ApiError.internal(new Error('VISITOR_HASH_SALT 가 설정되지 않았거나 너무 짧습니다'));
  }

  const input = `${ip}\n${userAgent}\n${salt}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));

  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 클라이언트 IP.
 *
 * 이 Worker 는 Cloudflare 뒤에만 존재하므로 CF-Connecting-IP 를 신뢰한다.
 * Cloudflare 가 이 헤더를 항상 덮어쓰기 때문에 위조해서 들어올 방법이 없다.
 */
export function clientIp(headers: Headers): string {
  return headers.get('CF-Connecting-IP') ?? headers.get('X-Real-IP') ?? '0.0.0.0';
}
