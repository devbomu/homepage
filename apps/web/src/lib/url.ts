/**
 * 방문자가 남긴 링크 주소를 화면에 걸기 전에 거른다.
 *
 * API 가 이미 스킴을 검사하지만(apps/api/src/lib/url.ts) 여기서 한 번 더 본다.
 * 이유가 두 가지다.
 *   - 검사가 생기기 전에 들어온 값이 DB 에 남아 있을 수 있다.
 *   - href 에 넣는 쪽이 여기라, 안전 판단도 여기 있는 편이 어긋나지 않는다.
 *
 * javascript: 나 data: 가 <a href> 에 들어가면 그 링크를 누른 다른 방문자의
 * 브라우저에서 실행된다. CSP 가 막아주지만 그건 마지막 그물이다.
 */
export function safeLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? value : null;
  } catch {
    // 상대경로나 빈 문자열 등 파싱되지 않는 값은 링크로 쓰지 않는다.
    return null;
  }
}
