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
 *  - 자주 쓰는 표기를 끼워 넣는 도구 모음 (선택 영역을 감싸거나 줄머리에 붙인다)
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
  | { kind: 'wrap'; before: string; after: string; placeholder: string }
  | { kind: 'line'; prefix: string; placeholder: string };

interface Tool {
  label: string;
  title: string;
  action: Action;
}

const TOOLS: Tool[] = [
  {
    label: 'H2',
    title: '제목 (## )',
    action: { kind: 'line', prefix: '## ', placeholder: '제목' },
  },
  {
    label: 'H3',
    title: '작은 제목 (### )',
    action: { kind: 'line', prefix: '### ', placeholder: '작은 제목' },
  },
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
    label: '취소선',
    title: '취소선',
    action: { kind: 'wrap', before: '~~', after: '~~', placeholder: '취소선' },
  },
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
    label: '코드',
    title: '인라인 코드',
    action: { kind: 'wrap', before: '`', after: '`', placeholder: 'code' },
  },
  {
    label: '코드블록',
    title: '코드 블록',
    action: { kind: 'wrap', before: '```ts\n', after: '\n```', placeholder: 'const x = 1;' },
  },
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
    label: '인용',
    title: '인용문',
    action: { kind: 'line', prefix: '> ', placeholder: '인용' },
  },
];

/** 목록·인용 줄의 머리 표기. Enter 를 쳤을 때 다음 줄에 이어 붙인다. */
const LIST_LINE = /^(\s*)(?:([-*+])|(\d+)\.|(>))\s+/;

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

  const run = useCallback(
    (action: Action) => {
      const node = ref.current;
      if (!node) return;

      const { selectionStart: start, selectionEnd: end } = node;
      const selected = value.slice(start, end);

      if (action.kind === 'wrap') {
        const inner = selected || action.placeholder;
        const next = `${value.slice(0, start)}${action.before}${inner}${action.after}${value.slice(end)}`;
        const from = start + action.before.length;
        apply(next, from, from + inner.length);
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
      apply(next, lineStart, lineStart + prefixed.length);
    },
    [apply, value],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = event.metaKey || event.ctrlKey;

    if (mod) {
      const key = event.key.toLowerCase();
      const tool = TOOLS.find(
        (t) =>
          (key === 'b' && t.label === 'B') ||
          (key === 'i' && t.label === 'I') ||
          (key === 'k' && t.label === '링크'),
      );
      if (tool) {
        event.preventDefault();
        run(tool.action);
      }
      return;
    }

    if (event.key !== 'Enter' || event.shiftKey) return;

    // 목록 안에서 Enter: 다음 줄에 같은 표기를 이어 준다.
    const node = event.currentTarget;
    const start = node.selectionStart;
    if (start !== node.selectionEnd) return;

    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const line = value.slice(lineStart, start);
    const match = LIST_LINE.exec(line);
    if (!match) return;

    event.preventDefault();

    // 표기만 있고 내용이 비어 있으면 목록을 끝낸다.
    if (line.trim() === match[0].trim()) {
      const next = `${value.slice(0, lineStart)}${value.slice(start)}`;
      apply(next, lineStart, lineStart);
      return;
    }

    const [, indent, bullet, ordered, quote] = match;
    const marker = bullet ? `${bullet} ` : ordered ? `${Number(ordered) + 1}. ` : quote ? '> ' : '';
    const insert = `\n${indent ?? ''}${marker}`;
    const next = `${value.slice(0, start)}${insert}${value.slice(start)}`;
    apply(next, start + insert.length, start + insert.length);
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
        <div className="border-base-300 bg-base-200/40 flex flex-wrap gap-1 rounded-lg border p-1">
          {TOOLS.map((tool) => (
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
      )}

      {showPreview ? (
        preview.isPending ? (
          <Loading />
        ) : (
          <div
            className={`preview bg-base-200/40 rounded-lg p-4 ${minHeight}`}
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
          placeholder={placeholder}
          spellCheck={false}
        />
      )}
    </div>
  );
}
