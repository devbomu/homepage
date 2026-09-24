/**
 * 제목에서 slug 후보를 만든다.
 *
 * 한글은 로마자로 바꾸지 않고 그대로 둔다. 기계적인 음차는 읽기 어려운 결과를 내고
 * ('개발자' -> 'gaebalja'), 한글 URL 은 브라우저가 알아서 인코딩한다.
 * 관리자가 원하면 직접 ASCII slug 를 넣으면 된다.
 *
 * 스키마의 CHECK 제약과 같은 규칙을 지켜야 한다:
 * 소문자 / 공백 없음 / [ /?#&=%+] 없음 / 1~200자.
 */
export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    // URL 예약문자와 대부분의 구두점을 걷어낸다. 한글·영문·숫자·하이픈만 남긴다.
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);

  // 제목이 전부 기호였던 경우의 폴백.
  return slug || randomSlug();
}

/**
 * 임의의 주소.
 *
 * 주소 칸을 비워 두면 이걸 쓴다. 제목에서 만들지 않는 이유는 한글 제목이
 * 그대로 주소가 되면 링크에 `%EA%B0%9C...` 가 길게 붙기 때문이다.
 * 읽히는 주소를 원하면 관리자 화면의 '제목에서' 를 눌러 채우면 된다.
 *
 * 열 자리 base36 이면 경우의 수가 36^10(약 3.6경)이라 충돌은 사실상 없고,
 * 그래도 겹치면 uniqueSlug 가 뒤에 번호를 붙인다.
 */
export function randomSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value.toString(36).slice(0, 10).padStart(10, '0');
}

/** 이미 쓰이는 slug 면 -2, -3 을 붙인다. */
export async function uniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) return base;

  for (let n = 2; n <= 50; n += 1) {
    const candidate = `${base.slice(0, 195)}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base.slice(0, 190)}-${Date.now()}`;
}

/**
 * 관리자가 입력한 주소를 쓸 값으로 바꾼다.
 * 비어 있으면 임의 주소를 만든다 — 제목에서 만들지 않는다.
 */
export function resolveSlug(input: string | null | undefined): string {
  const trimmed = input?.trim();
  return trimmed ? slugify(trimmed) : randomSlug();
}
