import { z } from 'zod';

/**
 * 방문자가 입력하는 링크 주소.
 *
 * z.url() 을 그대로 쓰면 안 된다. new URL() 로 파싱만 하기 때문에
 * `javascript:alert(1)`, `data:text/html,...`, `vbscript:...` 이 전부 "올바른 주소" 로
 * 통과한다 (zod 4 에서 실제로 확인했다).
 *
 * 이 값은 공개 화면에서 <a href> 로 그대로 들어간다. 즉 스킴을 좁히지 않으면
 * 인증 없는 방문자가 남긴 문자열이 다른 방문자의 브라우저에서 실행된다.
 * CSP 가 한 겹 더 막아주지만, 애초에 받지 않는 것이 맞다.
 *
 * 허용: http, https. 그 외는 전부 거부한다.
 * (mailto/tel 은 "홈페이지" 칸에 들어올 이유가 없다.)
 */
export const visitorUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'http:// 또는 https:// 로 시작하는 주소만 쓸 수 있습니다.');
