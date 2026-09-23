import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Field } from '../src/components/ui';

/**
 * 이 테스트가 생긴 이유:
 * Field 가 Children.only 를 쓰던 시절, 설정 화면이 검증 메시지를 하나 더 넘기는 바람에
 * 렌더가 통째로 터져 흰 화면만 나왔다. 타입 검사도 빌드도 잡지 못했고
 * 실제 배포 뒤에야 드러났다.
 */
describe('Field', () => {
  it('자식이 하나면 라벨을 컨트롤에 연결한다', () => {
    const html = renderToString(
      <Field label="이름">
        <input name="x" />
      </Field>,
    );
    const forId = /for="([^"]+)"/.exec(html)?.[1];
    expect(forId).toBeTruthy();
    expect(html).toContain(`id="${forId}"`);
  });

  it('자식이 여럿이어도 터지지 않는다', () => {
    expect(() =>
      renderToString(
        <Field label="소셜 링크">
          <textarea name="social" />
          <span>형식이 올바르지 않습니다</span>
        </Field>,
      ),
    ).not.toThrow();
  });

  it('자식이 여럿일 때도 폼 컨트롤에 라벨을 연결한다', () => {
    const html = renderToString(
      <Field label="소셜 링크">
        <textarea name="social" />
        <span>형식이 올바르지 않습니다</span>
      </Field>,
    );
    const forId = /for="([^"]+)"/.exec(html)?.[1];
    expect(forId).toBeTruthy();
    // id 는 span 이 아니라 textarea 에 붙어야 한다.
    expect(html).toMatch(new RegExp(`<textarea[^>]*id="${forId}"`));
  });

  it('조건부 자식이 false 로 접혀도 터지지 않는다', () => {
    const error: string | null = null;
    expect(() =>
      renderToString(
        <Field label="이름">
          <input name="x" />
          {error && <span>{error}</span>}
        </Field>,
      ),
    ).not.toThrow();
  });

  it('폼 컨트롤이 없으면 group 으로 묶는다', () => {
    const html = renderToString(
      <Field label="태그">
        <div>
          <button type="button">태그1</button>
        </div>
      </Field>,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="태그"');
    // 라벨을 붙일 수 없는 대상에 htmlFor 를 걸면 안 된다.
    expect(html).not.toContain('for=');
  });

  it('힌트를 aria-describedby 로 잇는다', () => {
    const html = renderToString(
      <Field label="주소" hint="비워두면 자동 생성합니다">
        <input name="slug" />
      </Field>,
    );
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
  });
});
