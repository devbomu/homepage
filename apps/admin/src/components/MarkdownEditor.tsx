import { useMutation } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import { adminApi } from '../lib/api';
import { Loading } from './ui';

/**
 * 마크다운 편집기.
 *
 * WYSIWYG 이 아니라 마크다운 그대로를 다룬다. 저장되는 값이 마크다운이고
 * 공개 화면은 그것을 서버에서 렌더하므로, 편집기가 HTML 을 만들기 시작하면
 * 원본과 렌더 결과가 갈라진다. 대신 손이 덜 가도록 세 가지를 붙였다.
 *
 *  - 자주 쓰는 표기를 끼워 넣는 도구 모음
 *  - Cmd/Ctrl + B / I / K 단축키
 *  - 목록·인용 안에서 Enter 를 치면 다음 줄에 같은 표기를 이어준다
 *
 * 미리보기는 서버의 렌더러를 그대로 부른다. 화면에서 따로 렌더하면
 * 실제로 게시될 결과와 미묘하게 달라진다.
 */

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** 편집 영역 최소 높이. Tailwind 클래스. */
  minHeight?: string;
  placeholder?: string;
  label?: string;
}

type Action =
  /** 선택한 글자를 앞뒤로 감싼다. */
  | { kind: 'wrap'; before: string; after: string; placeholder: string }
  /** 선택한 줄들의 머리에 표기를 붙인다. */
  | { kind: 'line'; prefix: string; placeholder: string }
  /**
   * 여러 줄짜리 덩어리를 통째로 끼워 넣는다.
   * select 는 끼워 넣은 글자 안에서 선택할 구간이다.
   */
  | { kind: 'block'; text: string; select?: [number, number] };

interface Tool {
  label: string;
  title: string;
  action: Action;
}

/** 표 뼈대. 첫 머리칸을 선택해 두어 바로 고쳐 쓸 수 있게 한다. */
const TABLE = ['| 항목 | 설명 |', '| --- | --- |', '|  |  |'].join('\n');

const GROUPS: Tool[][] = [
  [
    { label: 'H2', title: '제목', action: { kind: 'line', prefix: '## ', placeholder: '제목' } },
    {
      label: 'H3',
      title: '작은 제목',
      action: { kind: 'line', prefix: '### ', placeholder: '작은 제목' },
    },
  ],
  [
    {
      label: 'B',
      title: '굵게 (Cmd/Ctrl + B)',
      action: { kind: 'wrap', before: '**', after: '**', placeholder: '굵게' },
    },
    {
      label: 'I',
      title: '기울임 (Cmd/Ctrl + I)',
      action: { kind: 'wrap', before: '_', after: '_', placeholder: '기울임' },
    },
    {
      label: 'S',
      title: '취소선',
      action: { kind: 'wrap', before: '~~', after: '~~', placeholder: '취소선' },
    },
    {
      label: '형광펜',
      title: '형광펜으로 강조합니다',
      action: { kind: 'wrap', before: '==', after: '==', placeholder: '중요' },
    },
    {
      label: '코드',
      title: '인라인 코드',
      action: { kind: 'wrap', before: '`', after: '`', placeholder: 'code' },
    },
  ],
  [
    {
      label: '목록',
      title: '글머리 기호 목록',
      action: { kind: 'line', prefix: '- ', placeholder: '항목' },
    },
    {
      label: '번호',
      title: '번호 목록',
      action: { kind: 'line', prefix: '1. ', placeholder: '항목' },
    },
    {
      label: '체크',
      title: '체크박스 목록',
      action: { kind: 'line', prefix: '- [ ] ', placeholder: '할 일' },
    },
    { label: '인용', title: '인용문', action: { kind: 'line', prefix: '> ', placeholder: '인용' } },
  ],
  [
    {
      label: '링크',
      title: '링크 (Cmd/Ctrl + K)',
      action: { kind: 'wrap', before: '[', after: '](https://)', placeholder: '링크 글자' },
    },
    {
      label: '이미지',
      title: '이미지. 주소는 미디어 화면에서 복사합니다',
      action: { kind: 'wrap', before: '![', after: '](https://)', placeholder: '대체 텍스트' },
    },
    {
      label: '표',
      title: '표 뼈대를 넣습니다',
      action: { kind: 'block', text: TABLE, select: [2, 4] },
    },
    {
      label: '코드블록',
      title: '코드 블록',
      action: { kind: 'wrap', before: '```ts\n', after: '\n```', placeholder: 'const x = 1;' },
    },
    { label: '구분선', title: '가로줄', action: { kind: 'block', text: '---' } },
  ],
];

/**
 * 알림 상자. 종류가 다섯이라 버튼으로 늘어놓으면 도구 모음이 너무 길어진다.
 * 색은 공개 화면에서 종류별로 붙는다.
 */
const ALERTS = [
  { kind: 'NOTE', icon: '📘', label: '참고' },
  { kind: 'TIP', icon: '💡', label: '팁' },
  { kind: 'IMPORTANT', icon: '❗', label: '중요' },
  { kind: 'WARNING', icon: '⚠️', label: '주의' },
  { kind: 'CAUTION', icon: '🛑', label: '경고' },
] as const;

function alertAction(kind: string): Action {
  const text = `> [!${kind}]\n> 내용`;
  return { kind: 'block', text, select: [text.length - 2, text.length] };
}

/** 목록·인용 줄의 머리 표기. Enter 를 쳤을 때 다음 줄에 이어 붙인다. */
const LIST_LINE = /^(\s*)(?:- \[[ xX]\]|([-*+])|(\d+)\.|(>))\s+/;

/**
 * 목록·인용 안에서 Enter 를 쳤을 때 할 일을 계산한다.
 *
 * 순수 함수로 떼어 둔 이유는 테스트 때문이다. DOM 없이 글자와 커서 위치만으로
 * 결과가 정해지므로, 한글 입력처럼 재현하기 까다로운 경우도 여기서는 그냥
 * "이 글자에 이 커서" 로 확인할 수 있다.
 *
 * 이어갈 것이 없으면 null 을 돌려주고, 호출부는 브라우저 기본 동작에 맡긴다.
 */
export function continueList(text: string, caret: number): { text: string; caret: number } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const line = text.slice(lineStart, caret);
  const match = LIST_LINE.exec(line);
  if (!match) return null;

  // 표기만 있고 내용이 비어 있으면 목록을 끝낸다.
  if (line.trim() === match[0].trim()) {
    return { text: `${text.slice(0, lineStart)}${text.slice(caret)}`, caret: lineStart };
  }

  const [, indent, bullet, ordered, quote] = match;
  const marker = match[0].includes('[')
    ? '- [ ] '
    : bullet
      ? `${bullet} `
      : ordered
        ? `${Number(ordered) + 1}. `
        : quote
          ? '> '
          : '';

  const insert = `\n${indent ?? ''}${marker}`;
  return {
    text: `${text.slice(0, caret)}${insert}${text.slice(caret)}`,
    caret: caret + insert.length,
  };
}

export default function MarkdownEditor({
  value,
  onChange,
  minHeight = 'min-h-[28rem]',
  placeholder = '## 제목\n\n마크다운으로 작성합니다.',
  label = '본문 (마크다운)',
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  const preview = useMutation({
    mutationFn: (content: string) => adminApi.preview(content).then((r) => r.data.contentHtml),
  });

  /*
   * 값을 바꾼 뒤 커서를 원하는 곳에 다시 놓는다.
   *
   * 커서를 곧바로 옮기면 안 된다. value 는 부모가 들고 있어서 React 가 다시
   * 그린 다음에야 textarea 에 반영되고, 그 순간 브라우저가 커서를 맨 끝으로
   * 보내 버린다. 자리를 적어 뒀다가 DOM 이 갱신된 직후에 옮긴다.
   */
  const pendingSelection = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    const target = pendingSelection.current;
    if (!node || !target) return;
    pendingSelection.current = null;
    node.focus();
    node.setSelectionRange(target[0], target[1]);
  }, [value]);

  const apply = useCallback(
    (next: string, selectionStart: number, selectionEnd: number) => {
      pendingSelection.current = [selectionStart, selectionEnd];
      onChange(next);
    },
    [onChange],
  );

  /*
   * 마지막 커서 위치.
   *
   * 알림 드롭다운은 열리면서 포커스를 가져간다. 도구 모음의 다른 버튼들은
   * mousedown 에서 preventDefault 로 포커스 이동을 막지만, 드롭다운은 포커스를
   * 받아야 열리므로 그럴 수 없다. 그래서 포커스가 넘어가기 직전인 mousedown 에서
   * 커서 자리를 적어 둔다. blur 에 기대지 않는 이유는, 창이 뒤에 있을 때
   * 브라우저가 focus/blur 를 건너뛰는 경우가 있기 때문이다.
   */
  const lastSelection = useRef<[number, number]>([0, 0]);

  const rememberSelection = () => {
    const node = ref.current;
    if (node) lastSelection.current = [node.selectionStart, node.selectionEnd];
  };

  const run = useCallback(
    (action: Action) => {
      const node = ref.current;
      if (!node) return;

      const focused = document.activeElement === node;
      const start = focused ? node.selectionStart : lastSelection.current[0];
      const end = focused ? node.selectionEnd : lastSelection.current[1];
      // 커서 위치가 DOM 기준이므로 글자도 DOM 에서 읽는다 (위 continueList 와 같은 이유).
      const value = node.value;
      const selected = value.slice(start, end);

      if (action.kind === 'wrap') {
        const inner = selected || action.placeholder;
        const next = `${value.slice(0, start)}${action.before}${inner}${action.after}${value.slice(end)}`;
        const from = start + action.before.length;
        apply(next, from, from + inner.length);
        return;
      }

      if (action.kind === 'block') {
        // 덩어리는 항상 빈 줄에서 시작하게 한다. 문단 중간에 표를 넣으면
        // 마크다운이 그 문단의 일부로 읽어 버린다.
        const before = value.slice(0, start);
        const lead =
          before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
        const rest = value.slice(end);
        const tail = rest.startsWith('\n') ? '\n' : '\n\n';
        const inserted = `${lead}${action.text}${tail}`;
        const next = `${before}${inserted}${rest}`;
        const base = start + lead.length;
        const [from, to] = action.select ?? [action.text.length, action.text.length];
        apply(next, base + from, base + to);
        return;
      }

      // 줄머리 표기는 선택한 모든 줄에 붙인다.
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end);
      const block = value.slice(lineStart, lineEnd) || action.placeholder;
      const prefixed = block
        .split('\n')
        .map((line) => (line.startsWith(action.prefix) ? line : `${action.prefix}${line}`))
        .join('\n');

      const next = `${value.slice(0, lineStart)}${prefixed}${value.slice(lineEnd)}`;
      // 표기는 빼고 글자만 선택한다. `- ` 까지 잡혀 있으면 바로 고쳐 쓸 수 없다.
      apply(next, lineStart + action.prefix.length, lineStart + prefixed.length);
    },
    [apply],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = event.metaKey || event.ctrlKey;

    if (mod) {
      const key = event.key.toLowerCase();
      const shortcut = key === 'b' ? 'B' : key === 'i' ? 'I' : key === 'k' ? '링크' : null;
      if (!shortcut) return;
      const tool = GROUPS.flat().find((t) => t.label === shortcut);
      if (tool) {
        event.preventDefault();
        run(tool.action);
      }
      return;
    }

    if (event.key !== 'Enter' || event.shiftKey) return;

    /*
     * 한글을 조합하는 중이면 손대지 않는다.
     *
     * 한글 입력기는 마지막 글자를 아직 확정하지 않은 상태로 들고 있다가
     * Enter 를 확정 신호로 쓴다. 이때 우리가 가로채 줄을 만들면 확정된 글자가
     * 새 줄에 한 번 더 들어가, 끝 글자가 아래로 복사된 것처럼 보인다.
     * 조합이 끝난 뒤의 Enter 만 우리 것이다.
     */
    if (event.nativeEvent.isComposing) return;

    // 목록 안에서 Enter: 다음 줄에 같은 표기를 이어 준다.
    const node = event.currentTarget;
    if (node.selectionStart !== node.selectionEnd) return;

    /*
     * 글자는 React 상태가 아니라 DOM 에서 읽는다. 커서 위치(selectionStart)가
     * DOM 기준이라, 상태가 한 글자라도 뒤처져 있으면 엉뚱한 자리를 자른다.
     */
    const result = continueList(node.value, node.selectionStart);
    if (!result) return;

    event.preventDefault();
    apply(result.text, result.caret, result.caret);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-base-content/40 text-xs">
            {value.length.toLocaleString('ko-KR')}자
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => {
              setShowPreview((v) => !v);
              if (!showPreview) preview.mutate(value);
            }}
          >
            {showPreview ? '편집' : '미리보기'}
          </button>
        </div>
      </div>

      {!showPreview && (
        <div
          className="border-base-300 bg-base-200/40 flex flex-wrap items-center gap-1 rounded-lg border p-1"
          role="toolbar"
          aria-label="마크다운 도구"
        >
          {GROUPS.map((group, index) => (
            <div key={group[0]!.label} className="flex items-center gap-1">
              {index > 0 && <span className="bg-base-300 mx-1 h-4 w-px" aria-hidden="true" />}
              {group.map((tool) => (
                <button
                  key={tool.label}
                  type="button"
                  className="btn btn-ghost btn-xs font-normal"
                  title={tool.title}
                  // 버튼을 눌러도 편집 영역의 선택이 풀리지 않게 한다.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => run(tool.action)}
                >
                  {tool.label}
                </button>
              ))}
            </div>
          ))}

          <span className="bg-base-300 mx-1 h-4 w-px" aria-hidden="true" />
          <div className="dropdown">
            <button
              type="button"
              tabIndex={0}
              className="btn btn-ghost btn-xs font-normal"
              title="색이 들어간 알림 상자"
              // 포커스가 넘어가기 전에 커서 자리를 적어 둔다.
              onMouseDown={rememberSelection}
            >
              알림 ▾
            </button>
            <ul
              tabIndex={0}
              className="dropdown-content menu bg-base-100 rounded-box z-10 w-32 p-1 shadow"
            >
              {ALERTS.map((alert) => (
                <li key={alert.kind}>
                  <button
                    type="button"
                    className="text-xs"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => run(alertAction(alert.kind))}
                  >
                    <span aria-hidden="true">{alert.icon}</span> {alert.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showPreview ? (
        preview.isPending ? (
          <Loading />
        ) : (
          <div
            /*
             * 공개 화면과 같은 클래스를 쓴다 (`prose prose-lg`).
             * 예전에는 관리자만 쓰는 `.preview` 안에 스타일을 따로 적어 두어서,
             * 공개 화면의 인용문·표·이미지 스타일이 미리보기에는 없었다.
             */
            className={`prose prose-lg bg-base-200/40 max-w-none rounded-lg p-4 ${minHeight}`}
            // 서버가 렌더한 HTML 이다. 원시 HTML 이스케이프와 URL 스킴 검사를 거친 결과라
            // 공개 화면에 나갈 것과 완전히 같다.
            dangerouslySetInnerHTML={{ __html: preview.data ?? '' }}
          />
        )
      ) : (
        <textarea
          ref={ref}
          className={`textarea textarea-bordered w-full font-mono text-sm leading-relaxed ${minHeight}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onSelect={rememberSelection}
          onBlur={rememberSelection}
          placeholder={placeholder}
          spellCheck={false}
        />
      )}
    </div>
  );
}
