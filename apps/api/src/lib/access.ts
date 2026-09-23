import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { AdminIdentity, Bindings } from '../env';
import { isDevelopment, parseList } from '../env';
import { ApiError } from './errors';

/** Access 가 원본 요청에 주입하는 JWT 헤더. */
export const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';
/** 브라우저 흐름에서 쓰이는 쿠키. */
export const ACCESS_COOKIE = 'CF_Authorization';

/**
 * JWKS 는 아이솔레이트 단위로 캐시한다.
 * jose 가 내부적으로 키를 캐시하고 만료되면 자동으로 다시 가져오므로,
 * Cloudflare 가 서명키를 교체해도 재배포 없이 따라간다.
 */
const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(teamDomain: string) {
  let jwks = jwksByTeam.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, jwks);
  }
  return jwks;
}

export function tokenFromRequest(headers: Headers): string | undefined {
  const header = headers.get(ACCESS_HEADER);
  if (header) return header;

  const cookie = headers.get('Cookie');
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ACCESS_COOKIE) return rest.join('=');
  }
  return undefined;
}

/**
 * Cloudflare Access JWT 를 검증하고 신원을 돌려준다.
 *
 * 이 서버는 비밀번호도 세션도 다루지 않는다. admin.namsu.kim 과
 * api.namsu.kim/v1/admin/* 앞단의 Access 가 신원 확인을 끝내고
 * 서명된 JWT 를 실어 보내면, 여기서는 서명만 확인한다.
 *
 * 전제: API 의 관리자 경로도 Access 정책 뒤에 있어야 한다.
 * 프런트만 막고 API 를 열어두면 이 검증은 의미가 없다.
 */
export async function verifyAccessToken(
  env: Bindings,
  token: string | undefined,
): Promise<AdminIdentity> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CF_ACCESS_AUD?.trim();

  // 개발 환경에서 Access 설정이 없으면 통과시킨다.
  // 운영에서는 index.ts 의 기동 점검이 빈 설정을 막는다.
  if (!teamDomain || !audience) {
    if (isDevelopment(env)) {
      return { email: 'dev@localhost', commonName: '', subject: 'dev' };
    }
    throw ApiError.internal(new Error('Cloudflare Access 설정이 비어 있습니다'));
  }

  if (!token) throw ApiError.unauthorized('Access 토큰이 없습니다.');

  const issuer = `https://${teamDomain}`;

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, jwksFor(teamDomain), {
      issuer,
      audience,
      // Access 는 RS256 으로만 서명한다. 알고리즘을 고정해
      // alg=none 이나 HMAC 혼동 공격을 막는다.
      algorithms: ['RS256'],
      clockTolerance: 30,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (cause) {
    throw new ApiError(401, 'unauthorized', 'Access 토큰이 유효하지 않습니다.', { cause });
  }

  const identity: AdminIdentity = {
    email: typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : '',
    commonName: typeof payload.common_name === 'string' ? payload.common_name.trim() : '',
    subject: typeof payload.sub === 'string' ? payload.sub : '',
  };

  if (!identity.email && !identity.commonName) {
    throw ApiError.unauthorized('Access 토큰에 신원 정보가 없습니다.');
  }

  return identity;
}

/**
 * 허용된 관리자인지 확인하는 2차 방어선.
 *
 * Access 정책이 1차 방어선이고, 이건 Access 정책이 잘못 열렸을 때를 대비한 것이다.
 * 서비스 토큰(기계 호출)은 Access 정책에서 이미 걸러지므로 통과시킨다.
 */
export function isAllowedAdmin(env: Bindings, identity: AdminIdentity): boolean {
  if (identity.commonName && !identity.email) return true;

  const allowed = parseList(env.ADMIN_EMAILS).map((e) => e.toLowerCase());
  if (allowed.length === 0) return isDevelopment(env);

  return allowed.includes(identity.email);
}
