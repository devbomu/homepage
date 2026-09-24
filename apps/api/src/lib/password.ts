/**
 * 비밀글의 비밀번호 처리.
 *
 * 평문은 어디에도 저장하지 않는다. PBKDF2-SHA256 해시만 DB 에 들어간다.
 * Workers 에는 bcrypt/argon2 가 없고 네이티브 모듈도 못 올리므로
 * Web Crypto 가 기본으로 주는 PBKDF2 를 쓴다.
 *
 * 한 번 푼 사람이 페이지를 옮길 때마다 다시 입력하지 않도록 서명 토큰을 준다.
 * 비밀번호 자체를 브라우저에 저장하는 것보다 낫다 — 토큰은 글 하나에만,
 * 그것도 만료 시각까지만 쓸 수 있다.
 */

const ITERATIONS = 100_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

/** 토큰 유효 기간. 하루면 한 번 앉아서 읽는 동안은 충분하다. */
const TOKEN_TTL_SECONDS = 24 * 60 * 60;

const encoder = new TextEncoder();

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 길이가 달라도 일찍 빠져나가지 않는다. 맞은 글자 수가 시간으로 새면 안 된다. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return toBase64(bits);
}

/** 저장 형식: `pbkdf2$<반복>$<솔트>$<해시>`. 나중에 파라미터를 올려도 예전 해시를 읽을 수 있다. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  try {
    const salt = fromBase64(parts[2]!);
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
      key,
      KEY_BITS,
    );
    return timingSafeEqual(toBase64(bits), parts[3]!);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 해제 토큰
// ---------------------------------------------------------------------------

/**
 * 토큰 서명.
 *
 * 서명 대상에 비밀번호 해시를 함께 넣는다. 토큰 안에 담기지는 않고 서명에만
 * 섞이므로, 관리자가 비밀번호를 바꾸면 이미 발급된 토큰의 서명이 더 이상 맞지 않아
 * 그 자리에서 전부 무효가 된다. 예전에는 비밀번호를 바꿔도 기존 토큰이
 * 남은 기간 내내 통해서, 한 번 알았던 사람을 내보낼 방법이 없었다.
 */
async function sign(secret: string, payload: string, passwordHash: string): Promise<string> {
  // 솔트를 다른 용도(방문자 해시)와 함께 쓰므로 접두사로 용도를 갈라 둔다.
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`post-unlock:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${payload}\n${passwordHash}`));
  return toBase64(mac);
}

export interface UnlockToken {
  token: string;
  expiresAt: number;
}

export async function issueUnlockToken(
  secret: string,
  postId: number,
  passwordHash: string,
): Promise<UnlockToken> {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${postId}.${expiresAt}`;
  return { token: `${payload}.${await sign(secret, payload, passwordHash)}`, expiresAt };
}

/**
 * 이 토큰이 이 글의 것이고 아직 살아 있으면 만료 시각(초)을, 아니면 null 을 준다.
 *
 * 만료 시각을 돌려주는 이유: 호출부가 토큰을 새로 발급하지 않고 남은 기간을
 * 그대로 쓰게 하기 위함이다. 재발급하면 TTL 이 절대 기한이 아니라
 * 유휴 시간이 되어 버린다.
 */
export async function verifyUnlockToken(
  secret: string,
  postId: number,
  passwordHash: string,
  token: string,
): Promise<number | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [id, exp, signature] = parts as [string, string, string];
  if (Number(id) !== postId) return null;

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;

  const expected = await sign(secret, `${id}.${exp}`, passwordHash);
  return timingSafeEqual(expected, signature) ? expiresAt : null;
}
