/**
 * 본문 HTML 에서 목차를 뽑고, 각 제목에 앵커 id 를 심는다.
 *
 * API 가 넘겨주는 HTML 에는 id 가 없다 (marked 기본 렌더러는 붙이지 않는다).
 * 여기서 서버 렌더 중에 한 번 처리하므로 클라이언트 JS 가 필요 없다.
 */
export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

const HEADING = /<(h[23])>([\s\S]*?)<\/\1>/g;

/**
 * 태그를 지운다. 더 이상 바뀌지 않을 때까지 반복하는 것이 핵심이다.
 *
 * 한 번만 돌리면 지운 자리가 다시 붙어 태그가 되살아난다 —
 * `<<b>script>` 에서 `<b>` 를 지우면 `<script>` 가 남는다.
 * 매번 문자열이 짧아지거나 그대로이므로 반복은 반드시 끝난다.
 */
function stripTags(value: string): string {
  let previous: string;
  let current = value;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous);
  return current;
}

/**
 * 목차에 보여줄 평문으로 되돌린다.
 *
 * 본문은 이미 렌더러가 이스케이프해 둔 HTML 이라, 그대로 두면 목차에
 * "A &amp;amp; B" 처럼 실체 참조가 그대로 보인다.
 * `&amp;` 를 마지막에 푸는 것이 중요하다 — 먼저 풀면 `&amp;lt;` 가 두 번 풀려 `<` 가 된다.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&amp;/g, '&');
}

/** 속성값에 넣기 전에 다시 이스케이프한다. 따옴표 하나면 속성을 빠져나간다. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugifyHeading(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[\s]+/g, '-')
      .replace(/[^\p{L}\p{N}-]+/gu, '')
      .replace(/^-+|-+$/g, '') || 'section';

  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}-${n++}`;
  used.add(candidate);
  return candidate;
}

export function extractToc(html: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const used = new Set<string>();

  const withAnchors = html.replace(HEADING, (_match, tag: string, inner: string) => {
    const text = decodeEntities(stripTags(inner)).trim();
    const id = slugifyHeading(text, used);
    toc.push({ id, text, level: Number(tag[1]) });

    // id 는 slugifyHeading 이 글자·숫자·하이픈만 남기므로 그대로 넣어도 된다.
    // text 는 제목에 쓰인 문자가 그대로 들어오므로 반드시 이스케이프한다.
    const label = escapeAttribute(text);
    return `<${tag} id="${id}">${inner}<a class="heading-anchor" href="#${id}" aria-label="${label} 링크">#</a></${tag}>`;
  });

  return { html: withAnchors, toc };
}
