import { describe, expect, it } from 'vitest';

import { extractToc } from '../src/lib/toc';

describe('extractToc', () => {
  it('제목에서 목차를 뽑고 앵커 id 를 심는다', () => {
    const { html, toc } = extractToc('<h2>시작하기</h2><p>본문</p><h3>설치</h3>');
    expect(toc).toEqual([
      { id: '시작하기', text: '시작하기', level: 2 },
      { id: '설치', text: '설치', level: 3 },
    ]);
    expect(html).toContain('<h2 id="시작하기">');
    expect(html).toContain('href="#설치"');
  });

  it('같은 제목이 여러 번 나오면 id 를 구분한다', () => {
    const { toc } = extractToc('<h2>정리</h2><h2>정리</h2><h2>정리</h2>');
    expect(toc.map((t) => t.id)).toEqual(['정리', '정리-2', '정리-3']);
  });

  it('제목 안의 서식 태그는 목차 글자에서 빠진다', () => {
    const { toc } = extractToc('<h2>API <code>fetch</code> 쓰기</h2>');
    expect(toc[0]!.text).toBe('API fetch 쓰기');
  });

  /*
   * 태그를 지운 결과에 다시 태그가 남지 않는다.
   * CodeQL 의 js/incomplete-multi-character-sanitization 이 이 성질을 본다.
   * (이 정규식은 `<` 와 그 뒤의 `>` 를 늘 함께 먹어치워서 실제로 되살아나지는
   *  않지만, 그 논증에 기대지 않도록 더 이상 바뀌지 않을 때까지 돌린다.)
   */
  it('중첩·인접한 태그를 지워도 목차 글자에 태그가 남지 않는다', () => {
    const cases = [
      '<h2>a<<b>script>alert(1)<</b>/script>b</h2>',
      '<h2><em>겹<strong>친</strong> 태그</em></h2>',
      '<h2><a href="#"><code>fetch</code></a> 쓰기</h2>',
    ];
    for (const input of cases) {
      const { toc } = extractToc(input);
      expect(toc[0]!.text).not.toMatch(/<[a-z/][^>]*>/i);
    }
  });

  it('제목에 부등호를 글자로 써도 속성을 깨지 않는다', () => {
    // 렌더러가 &lt;script&gt; 로 내보낸 것은 "글자로 쓴 부등호" 다.
    // 목차에는 원래 글자로 보여주되, 속성에 넣을 때는 다시 이스케이프해야 한다.
    const { html, toc } = extractToc('<h2>부등호 &lt;script&gt; 쓰기</h2>');
    expect(toc[0]!.text).toBe('부등호 <script> 쓰기');
    const label = html.match(/aria-label="([^"]*)"/)?.[1] ?? '';
    expect(label).not.toContain('<');
    expect(label).not.toContain('>');
    expect(html).toContain('aria-label="부등호 &lt;script&gt; 쓰기 링크"');
  });

  it('따옴표가 들어간 제목이 속성을 빠져나가지 않는다', () => {
    const { html, toc } = extractToc('<h2>그가 &quot;안녕&quot; 이라 했다</h2>');
    expect(toc[0]!.text).toBe('그가 "안녕" 이라 했다');
    expect(html).toContain('aria-label="그가 &quot;안녕&quot; 이라 했다 링크"');
    // 속성이 중간에 끊겨 새 속성이 생기면 안 된다.
    expect(html).not.toMatch(/aria-label="[^"]*"[^>]*"/);
  });

  it('렌더러가 이스케이프해 둔 글자를 목차에서는 원래대로 보여준다', () => {
    const { toc } = extractToc('<h2>A &amp; B</h2>');
    expect(toc[0]!.text).toBe('A & B');
  });

  it('이미 이스케이프된 실체 참조를 두 번 풀지 않는다', () => {
    // 제목에 "&lt;" 라고 직접 쓴 경우. 렌더러는 &amp;lt; 로 내보낸다.
    const { toc } = extractToc('<h2>&amp;lt; 기호</h2>');
    expect(toc[0]!.text).toBe('&lt; 기호');
  });

  it('제목이 없으면 원본 HTML 을 그대로 돌려준다', () => {
    const input = '<p>제목 없는 글</p>';
    expect(extractToc(input)).toEqual({ html: input, toc: [] });
  });

  it('빈 제목에도 id 를 준다', () => {
    const { toc } = extractToc('<h2><em></em></h2>');
    expect(toc[0]!.id).toBe('section');
  });
});
