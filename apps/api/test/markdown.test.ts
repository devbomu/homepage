import { describe, expect, it } from 'vitest';

import { analyzeContent, autoSummary, renderMarkdown, stripMarkdown } from '../src/lib/markdown';

/**
 * 살아있는 위험 요소만 잡는다.
 * 이스케이프되어 텍스트로 남은 "&lt;script&gt;" 는 위험하지 않으므로
 * 실제 태그로 파싱될 수 있는 형태인지를 본다.
 */
function hasLiveXss(html: string): boolean {
  const dangerousTag = /<\s*(script|iframe|object|embed|style|link|meta|base|svg)\b/i;
  const eventHandler = /<[a-z][^>]*\son[a-z]+\s*=/i;
  const jsUrl = /<[a-z][^>]*\s(?:href|src)\s*=\s*["']?\s*(?:javascript|data|vbscript):/i;
  return dangerousTag.test(html) || eventHandler.test(html) || jsUrl.test(html);
}

describe('renderMarkdown — 원시 HTML 차단', () => {
  const attacks = [
    ['script 블록', '<script>alert(1)</script>'],
    ['인라인 img onerror', '보세요 <img src=x onerror=alert(1)> 끝'],
    ['iframe', '<iframe src="https://evil.example"></iframe>'],
    ['svg onload', '<svg onload=alert(1)>'],
    ['style 태그', '<style>body{display:none}</style>'],
    ['중첩 태그 우회', '<scr<script>ipt>alert(1)</script>'],
  ] as const;

  it.each(attacks)('%s 를 무력화한다', (_label, input) => {
    expect(hasLiveXss(renderMarkdown(input))).toBe(false);
  });
});

describe('renderMarkdown — URL 스킴 검사', () => {
  // 원시 HTML 이스케이프만으로는 못 막는 경로다.
  // 마크다운 링크 문법은 이스케이프를 거치지 않고 바로 href 가 된다.
  const blocked = [
    ['javascript: 링크', '[클릭](javascript:alert(1))'],
    ['대문자 우회', '[클릭](JaVaScRiPt:alert(1))'],
    ['제어문자 삽입 우회', '[클릭](java\tscript:alert(1))'],
    ['data: URL 링크', '[클릭](data:text/html,<script>alert(1)</script>)'],
    ['javascript: 이미지', '![alt](javascript:alert(1))'],
    ['vbscript: 링크', '[클릭](vbscript:msgbox(1))'],
  ] as const;

  it.each(blocked)('%s 를 차단한다', (_label, input) => {
    const html = renderMarkdown(input);
    expect(hasLiveXss(html)).toBe(false);
    expect(html).not.toMatch(/href="javascript/i);
  });

  it('차단된 링크는 텍스트만 남긴다', () => {
    expect(renderMarkdown('[클릭](javascript:alert(1))')).toContain('클릭');
  });

  it('프로토콜 상대 URL 을 차단한다', () => {
    expect(renderMarkdown('[클릭](//evil.example/x)')).not.toContain('href="//evil.example');
  });

  const allowed = [
    ['https', '[링크](https://example.com)', 'href="https://example.com"'],
    ['http', '[링크](http://example.com)', 'href="http://example.com"'],
    ['mailto', '[메일](mailto:hello@example.com)', 'href="mailto:hello@example.com"'],
    ['상대경로', '[글](/posts/hello)', 'href="/posts/hello"'],
    ['앵커', '[목차](#toc)', 'href="#toc"'],
  ] as const;

  it.each(allowed)('%s 는 허용한다', (_label, input, expected) => {
    expect(renderMarkdown(input)).toContain(expected);
  });

  it('외부 링크에 rel 을 붙인다', () => {
    expect(renderMarkdown('[링크](https://example.com)')).toContain('rel="noopener noreferrer"');
  });

  it('내부 링크에는 rel 을 붙이지 않는다', () => {
    expect(renderMarkdown('[글](/posts/hello)')).not.toContain('rel=');
  });
});

describe('renderMarkdown — 정상 렌더', () => {
  it('헤딩과 강조를 렌더한다', () => {
    const html = renderMarkdown('# 제목\n\n**굵게**');
    expect(html).toContain('<h1>제목</h1>');
    expect(html).toContain('<strong>굵게</strong>');
  });

  it('코드 블록에 언어 클래스를 붙인다', () => {
    expect(renderMarkdown('```ts\nconst x = 1;\n```')).toContain('class="language-ts"');
  });

  it('GFM 표를 렌더한다', () => {
    expect(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<table>');
  });

  it('이미지에 lazy loading 을 붙인다', () => {
    const html = renderMarkdown('![대체텍스트](https://example.com/a.png)');
    expect(html).toContain('alt="대체텍스트"');
    expect(html).toContain('loading="lazy"');
  });
});

describe('analyzeContent — 한국어 분량 계산', () => {
  it('한글은 글자 수로 센다', () => {
    // 공백 기준 단어 세기로는 2 가 나오지만 실제 분량은 그보다 크다.
    const { wordCount } = analyzeContent('안녕하세요 반갑습니다');
    expect(wordCount).toBe(10); // 공백 제외 한글 10자
  });

  it('영문은 단어 수로 센다', () => {
    expect(analyzeContent('hello world foo').wordCount).toBe(3);
  });

  it('읽기 시간은 최소 1분이다', () => {
    expect(analyzeContent('짧은 글').readingMinutes).toBe(1);
  });

  it('긴 한국어 글의 읽기 시간을 계산한다', () => {
    // 한글 1500자 ≈ 3분 (500자/분 기준)
    expect(analyzeContent('가'.repeat(1500)).readingMinutes).toBe(3);
  });

  it('코드 블록은 분량에서 제외한다', () => {
    const withCode = analyzeContent('본문입니다\n\n```js\nconst averyLongVariableName = 1;\n```');
    expect(withCode.wordCount).toBe(analyzeContent('본문입니다').wordCount);
  });

  it('빈 글을 다룬다', () => {
    expect(analyzeContent('')).toEqual({ wordCount: 0, readingMinutes: 0 });
  });
});

describe('stripMarkdown / autoSummary', () => {
  it('마크다운 문법을 걷어낸다', () => {
    expect(stripMarkdown('# 제목\n\n**굵게** 와 [링크](https://a.com)')).toBe('제목 굵게 와 링크');
  });

  it('긴 본문을 잘라 요약을 만든다', () => {
    const summary = autoSummary('가'.repeat(300));
    expect(summary).toHaveLength(161); // 160자 + 말줄임표
    expect(summary.endsWith('…')).toBe(true);
  });

  it('짧은 본문은 그대로 쓴다', () => {
    expect(autoSummary('짧은 소개글')).toBe('짧은 소개글');
  });
});
