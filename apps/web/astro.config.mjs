// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

/**
 * is:inline 스크립트의 CSP 해시를 파일에서 읽어 계산한다.
 *
 * Astro 는 자기가 처리한 스크립트만 해시해 준다. is:inline 은 손대지 않고
 * 그대로 내보내기 때문에 해시 목록에도 들어가지 않는다. 직접 넣어야 한다.
 *
 * 해시 문자열을 여기 상수로 적어두지 않는 이유: 스크립트를 한 글자만 고쳐도
 * 해시가 어긋나는데, 그 고장이 조용하다. 테마 스크립트가 막히면 빌드는
 * 멀쩡히 성공하고 다크 모드 사용자만 흰 화면을 보게 된다. 그래서 빌드마다
 * 원본에서 다시 계산한다.
 *
 * src 가 있는 is:inline(비컨·gtag 로더·Turnstile)은 본문이 없으므로 제외한다.
 * 그쪽은 scriptDirective.resources 의 호스트 허용으로 통과한다.
 */
/** @param {string} relativePath @returns {`sha256-${string}`[]} */
function inlineScriptHashes(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const pattern = /<script\b(?![^>]*\bsrc=)[^>]*\bis:inline\b[^>]*>([\s\S]*?)<\/script>/g;
  const bodies = [...source.matchAll(pattern)].map((match) => match[1]);

  if (bodies.length === 0) {
    // 조용히 빈 목록을 돌려주면 CSP 가 통과하면서 스크립트만 막힌다. 차라리 빌드를 세운다.
    throw new Error(`${relativePath} 에서 본문 있는 is:inline 스크립트를 찾지 못했습니다.`);
  }

  return bodies.map(
    (body) =>
      /** @type {`sha256-${string}`} */ (
        `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`
      ),
  );
}

export default defineConfig({
  site: 'https://www.namsu.kim',

  /**
   * SSR 로 돌린다.
   *
   * 정적 생성이면 글 하나 발행할 때마다 빌드를 기다려야 하는데,
   * 그러면 DB 기반 관리자를 만든 이유가 없어진다.
   * 대신 각 페이지에서 Cache-Control 을 걸어 Cloudflare 엣지가 받아내게 한다.
   */
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
  }),

  vite: {
    plugins: [tailwindcss()],
  },

  /**
   * CSP(Content-Security-Policy).
   *
   * 저장형 XSS 의 2차 방어선이다. 1차는 마크다운 렌더러가 원시 HTML 을 전부
   * 이스케이프하는 것인데(apps/api/src/lib/markdown.ts), 그 불변식 하나에만
   * 기대는 상태였다. 렌더러 설정이 한 줄 어긋나는 순간 바로 실행으로 이어진다.
   *
   * Astro 가 인라인 스크립트의 SHA-256 해시를 빌드 시점에 계산해
   * <meta http-equiv="content-security-policy"> 로 내보낸다.
   * 이 해시들은 빌드마다 바뀌므로 손으로 관리할 수 없고, 그래서 직접 nonce 를
   * 배선하는 대신 Astro 내장 기능을 쓴다.
   *
   * SSR 이므로 Astro 는 <meta> 가 아니라 Content-Security-Policy 응답 헤더로
   * 내보낸다. 헤더라서 frame-ancestors 도 여기에 그냥 넣으면 된다
   * (<meta> 였다면 브라우저가 무시했을 지시어다).
   */
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        // <base> 태그 주입으로 상대경로 스크립트를 납치하는 것을 막는다.
        "base-uri 'none'",
        // <object>/<embed> 는 쓰지 않는다. 플러그인은 CSP 우회 통로가 된다.
        "object-src 'none'",
        // 폼 전송지는 자기 자신뿐이다.
        "form-action 'self'",
        // 이 사이트를 iframe 에 넣을 이유가 없다 (X-Frame-Options 의 현대판).
        "frame-ancestors 'none'",
        /*
         * 이미지는 https 전체를 연다.
         * 본문에 외부 이미지를 넣는 것은 정상적인 글쓰기이고, 여기를 좁히면
         * 글을 쓰다가 이미지가 조용히 안 나오는 일이 생긴다.
         * 반면 얻는 보안 이득은 작다 — img 로 할 수 있는 것은 "누가 봤다" 정도이고,
         * 데이터를 빼내려면 스크립트가 필요한데 그쪽은 위에서 막혀 있다.
         */
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        /*
         * 자기 API, Turnstile, 그리고 두 애널리틱스의 수집 엔드포인트.
         *
         * www.google.com 이 들어 있는 이유: GA4 는 google-analytics.com 만 쓰는 게
         * 아니라 상황에 따라 www.google.com/g/collect 로도 보낸다. 브라우저에서
         * 실제로 돌려보고 나서야 발견했다. 없으면 수집이 조용히 끊긴다.
         */
        "connect-src 'self' https://api.namsu.kim https://challenges.cloudflare.com https://cloudflareinsights.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://www.google.com",
        // Turnstile 위젯이 iframe 으로 들어온다.
        'frame-src https://challenges.cloudflare.com',
        "manifest-src 'self'",
        'upgrade-insecure-requests',
      ],
      scriptDirective: {
        // 테마 초기화 스크립트와 GA 설정 스크립트 (둘 다 BaseLayout 의 is:inline)
        hashes: inlineScriptHashes('./src/layouts/BaseLayout.astro'),
        resources: [
          "'self'",
          // Cloudflare Web Analytics 비컨
          'https://static.cloudflareinsights.com',
          // Turnstile
          'https://challenges.cloudflare.com',
          // GA4 (gtag.js)
          'https://www.googletagmanager.com',
        ],
      },
      styleDirective: {
        /*
         * 스타일은 전부 외부 파일이다 (빌드 산출물을 확인했다 —
         * <style> 블록도, style 속성도 하나도 없다).
         * 그래서 'unsafe-inline' 없이 'self' 만으로 성립한다.
         */
        resources: ["'self'"],
      },
    },
  },

  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },

  devToolbar: { enabled: false },
});
