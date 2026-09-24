import { describe, expect, it } from 'vitest';

import { continueList } from '../src/components/MarkdownEditor';

/** 커서를 `|` 로 표시한 문자열을 (글자, 커서) 로 바꾼다. 테스트가 읽히게 하려는 것. */
function at(marked: string): [string, number] {
  const caret = marked.indexOf('|');
  return [marked.replace('|', ''), caret];
}

/** 결과를 다시 `|` 표기로 돌려 비교한다. */
function show(result: { text: string; caret: number } | null): string | null {
  if (!result) return null;
  return `${result.text.slice(0, result.caret)}|${result.text.slice(result.caret)}`;
}

describe('continueList', () => {
  it('글머리 목록을 이어간다', () => {
    expect(show(continueList(...at('- 첫 항목|')))).toBe('- 첫 항목\n- |');
  });

  it('번호 목록은 번호를 올린다', () => {
    expect(show(continueList(...at('1. 첫 항목|')))).toBe('1. 첫 항목\n2. |');
    expect(show(continueList(...at('9. 아홉|')))).toBe('9. 아홉\n10. |');
  });

  it('체크목록은 빈 체크박스로 이어간다', () => {
    expect(show(continueList(...at('- [x] 끝난 일|')))).toBe('- [x] 끝난 일\n- [ ] |');
  });

  it('인용문을 이어간다', () => {
    expect(show(continueList(...at('> 인용문|')))).toBe('> 인용문\n> |');
  });

  it('들여쓰기를 유지한다', () => {
    expect(show(continueList(...at('  - 안쪽 항목|')))).toBe('  - 안쪽 항목\n  - |');
  });

  it('내용이 비어 있으면 목록을 끝낸다', () => {
    expect(show(continueList(...at('- 첫 항목\n- |')))).toBe('- 첫 항목\n|');
  });

  it('목록이 아니면 아무것도 하지 않는다', () => {
    expect(continueList(...at('그냥 문장|'))).toBeNull();
    expect(continueList(...at('## 제목|'))).toBeNull();
    expect(continueList(...at('|'))).toBeNull();
  });

  it('줄 중간에서도 그 줄의 표기를 본다', () => {
    expect(show(continueList(...at('- 앞|뒤')))).toBe('- 앞\n- |뒤');
  });

  it('여러 줄 중 커서가 있는 줄만 본다', () => {
    const text = '문단입니다.\n\n- 첫 항목|\n- 둘째 항목';
    expect(show(continueList(...at(text)))).toBe('문단입니다.\n\n- 첫 항목\n- |\n- 둘째 항목');
  });

  /*
   * 한글 조합 중의 Enter 는 호출부에서 isComposing 으로 걸러 낸다.
   * 여기서는 "조합이 끝난 글자" 가 들어왔을 때 그 글자를 잃거나 복사하지
   * 않는다는 것만 본다.
   */
  it('끝 글자를 잃거나 복사하지 않는다', () => {
    const result = continueList('- 한글 항목', '- 한글 항목'.length);
    expect(result?.text).toBe('- 한글 항목\n- ');
    expect(result?.text.startsWith('- 한글 항목\n')).toBe(true);
  });
});
