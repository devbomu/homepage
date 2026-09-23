import { Marked } from 'marked';

/**
 * 마크다운 렌더링.
 *
 * 글 본문은 발행 시점에 한 번만 HTML 로 렌더해 content_html 에 캐시한다.
 * 요청마다 파싱하면 Workers CPU 시간을 그냥 태우는 셈이고,
 * RSS·관리자 미리보기·공개 페이지가 모두 같은 HTML 을 공유하게 된다.
 *
 * 원시 HTML 은 허용하지 않고 전부 이스케이프한다.
 * 이렇게 하면 "출력에 들어가는 태그는 marked 가 만든 것뿐"이라는 불변식이 생겨
 * 별도의 HTML 새니타이저 없이도 저장형 XSS 가 차단된다.
 * (Workers 에는 DOM 이 없어 DOMPurify 류를 쓸 수 없다.)
 *
 * 대가: 관리자가 본문에 <iframe> 같은 걸 직접 넣을 수 없다.
 * 임베드가 필요해지면 허용 목록 기반의 커스텀 문법을 추가하는 편이 안전하다.
 */
/**
 * 링크·이미지 URL 에서 허용할 스킴.
 *
 * 원시 HTML 을 이스케이프하는 것만으로는 부족하다.
 * `[클릭](javascript:alert(1))` 은 마크다운 문법이라 이스케이프를 거치지 않고
 * 그대로 <a href="javascript:..."> 가 된다. 스킴을 따로 검사해야 한다.
 */
function sanitizeUrl(href: string | null | undefined): string | null {
  if (!href) return null;

  // 제어문자를 먼저 걷어낸다. "java\tscript:" 처럼 중간에 탭·개행을 넣어
  // 스킴 검사를 우회하는 수법을 막기 위함이다.
  const normalized = href.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (!normalized) return null;

  // 스킴이 있으면 허용 목록에 있어야 한다.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  if (scheme) {
    const allowed = ['http', 'https', 'mailto', 'tel'];
    return allowed.includes(scheme[1]!.toLowerCase()) ? normalized : null;
  }

  // 스킴이 없으면 상대경로나 앵커다. 프로토콜 상대 URL(//evil.com)만 막는다.
  return normalized.startsWith('//') ? null : normalized;
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ raw }) {
      return escapeHtml(raw);
    },

    link({ href, title, tokens }) {
      const safe = sanitizeUrl(href);
      const text = this.parser.parseInline(tokens);
      // 차단된 링크는 링크를 벗기고 텍스트만 남긴다.
      if (!safe) return text;

      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      // 외부 링크에는 rel 을 붙인다 (탭 내빙 방지 + 랭크 전달 차단).
      const isExternal = /^https?:/i.test(safe);
      const relAttr = isExternal ? ' rel="noopener noreferrer"' : '';
      return `<a href="${escapeHtml(safe)}"${titleAttr}${relAttr}>${text}</a>`;
    },

    image({ href, title, text }) {
      const safe = sanitizeUrl(href);
      // 차단된 이미지는 대체텍스트만 남긴다.
      if (!safe) return escapeHtml(text ?? '');

      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text ?? '')}"${titleAttr} loading="lazy" decoding="async">`;
    },
  },
});

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false });
}

/** 마크다운 문법을 걷어내고 본문 텍스트만 남긴다 (요약·분량 계산용). */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ') // 코드 블록
    .replace(/`[^`]*`/g, ' ') // 인라인 코드
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 이미지
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 링크 → 링크 텍스트
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 헤딩 표시
    .replace(/^\s{0,3}>\s?/gm, '') // 인용
    .replace(/[*_~]{1,3}/g, '') // 강조
    .replace(/^\s*[-*+]\s+/gm, '') // 목록 표시
    .replace(/\s+/g, ' ')
    .trim();
}

/** 한중일 문자 (공백 기준 단어 수 세기가 통하지 않는 구간). */
const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/gu;

/**
 * 분량과 예상 읽기 시간.
 *
 * 한국어는 공백으로 단어를 세면 실제 분량이 크게 과소평가된다
 * ("개발자를" 이 한 단어). 그래서 CJK 는 글자 수로, 나머지는 단어 수로 따로 세고
 * 각각의 읽기 속도(한글 ~500자/분, 영문 ~220단어/분)를 적용한다.
 */
export function analyzeContent(markdown: string): { wordCount: number; readingMinutes: number } {
  const text = stripMarkdown(markdown);
  if (!text) return { wordCount: 0, readingMinutes: 0 };

  const cjkChars = text.match(CJK)?.length ?? 0;
  const latinWords = text
    .replace(CJK, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  const minutes = cjkChars / 500 + latinWords / 220;

  return {
    // 목록에 보여줄 "분량" 은 CJK 글자 + 라틴 단어를 합쳐 근사한다.
    wordCount: cjkChars + latinWords,
    readingMinutes: Math.max(1, Math.round(minutes)),
  };
}

/** 요약이 비어 있을 때 본문 앞부분으로 자동 생성한다. */
export function autoSummary(markdown: string, maxLength = 160): string {
  const text = stripMarkdown(markdown);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}
