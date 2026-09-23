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
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const id = slugifyHeading(text, used);
    toc.push({ id, text, level: Number(tag[1]) });

    return `<${tag} id="${id}">${inner}<a class="heading-anchor" href="#${id}" aria-label="${text} 링크">#</a></${tag}>`;
  });

  return { html: withAnchors, toc };
}
