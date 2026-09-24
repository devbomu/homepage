import { describe, expect, it } from 'vitest';

import { randomSlug, resolveSlug, slugify } from '../src/lib/slug';

describe('slugify', () => {
  it('공백과 밑줄을 하이픈으로 바꾼다', () => {
    expect(slugify('My_Custom Slug')).toBe('my-custom-slug');
  });

  it('한글은 그대로 남긴다', () => {
    expect(slugify('한글 제목입니다')).toBe('한글-제목입니다');
  });

  it('URL 예약문자를 걷어낸다', () => {
    expect(slugify('a/b?c#d&e=f%g+h')).toBe('abcdefgh');
  });

  it('앞뒤 하이픈과 연속 하이픈을 정리한다', () => {
    expect(slugify('--a---b--')).toBe('a-b');
  });

  it('남는 글자가 없으면 임의 주소로 떨어진다', () => {
    const slug = slugify('!!!');
    expect(slug).toMatch(/^[0-9a-z]{10}$/);
  });
});

describe('randomSlug', () => {
  it('열 자리 base36 이다', () => {
    expect(randomSlug()).toMatch(/^[0-9a-z]{10}$/);
  });

  it('부를 때마다 다르다', () => {
    const values = new Set(Array.from({ length: 200 }, () => randomSlug()));
    expect(values.size).toBe(200);
  });
});

describe('resolveSlug', () => {
  it('값이 있으면 정규화해서 쓴다', () => {
    expect(resolveSlug('  My Slug ')).toBe('my-slug');
  });

  it('비어 있으면 임의 주소를 만든다', () => {
    // 제목에서 만들지 않는다. 한글 제목이 그대로 주소가 되면 링크가 길어진다.
    for (const empty of ['', '   ', null, undefined]) {
      expect(resolveSlug(empty)).toMatch(/^[0-9a-z]{10}$/);
    }
  });
});
