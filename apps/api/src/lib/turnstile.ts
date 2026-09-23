const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Turnstile 토큰 검증.
 *
 * 비밀키가 비어 있으면 검증을 건너뛴다 — 로컬 개발에서 Turnstile 없이
 * 댓글 흐름을 돌려보기 위함이다. 운영에서는 기동 시 비밀키가 반드시 있어야 하며
 * (index.ts 에서 확인한다) 따라서 이 우회 경로를 타지 않는다.
 */
export async function verifyTurnstile(
  secret: string,
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  body.append('remoteip', ip);

  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body });
    if (!res.ok) return false;
    const result = (await res.json()) as TurnstileResponse;
    return result.success === true;
  } catch {
    // Turnstile 이 응답하지 않으면 통과시키지 않는다.
    // 스팸이 들어오는 것보다 잠깐 댓글이 막히는 편이 낫다.
    return false;
  }
}
