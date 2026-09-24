import { describe, expect, it } from 'vitest';

import { safeLink } from '../src/lib/url';

/**
 * 방문자가 남긴 링크는 다른 방문자의 브라우저에서 눌린다.
 * zod 의 url() 이 javascript: 를 통과시키는 것을 확인하고 추가한 방어다.
 */
describe('safeLink', () => {
  it('http/https 는 그대로 통과시킨다', () => {
    expect(safeLink('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeLink('http://example.com')).toBe('http://example.com');
  });

  it('javascript: 는 링크로 쓰지 않는다', () => {
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('JaVaScRiPt:alert(1)')).toBeNull();
  });

  it('data: 와 vbscript: 도 막는다', () => {
    expect(safeLink('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeLink('vbscript:msgbox(1)')).toBeNull();
  });

  it('스킴이 없거나 파싱되지 않는 값은 링크로 쓰지 않는다', () => {
    expect(safeLink('//evil.com')).toBeNull();
    expect(safeLink('example.com')).toBeNull();
    expect(safeLink('')).toBeNull();
    expect(safeLink(null)).toBeNull();
    expect(safeLink(undefined)).toBeNull();
  });
});
