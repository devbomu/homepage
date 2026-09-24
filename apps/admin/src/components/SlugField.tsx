import { Field } from './ui';

/**
 * 주소(slug) 입력칸.
 *
 * 비워 두면 서버가 임의의 주소를 만든다. 제목에서 만들지 않는 이유는 한글
 * 제목이 그대로 주소가 되면 링크에 `%EA%B0%9C...` 가 길게 붙기 때문이다.
 * 읽히는 주소를 원할 때를 위해 '제목에서' 버튼을 옆에 둔다.
 */

/**
 * 서버(`apps/api/src/lib/slug.ts`)의 규칙을 그대로 옮긴 것.
 * 어차피 서버가 저장 전에 한 번 더 돌리므로, 여기서 조금 달라도 결과는 서버가 정한다.
 * 여기 있는 이유는 버튼을 누른 순간 결과를 보여주기 위함이다.
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** '제목에서' 버튼이 가져올 값. */
  source: string;
  /** 버튼에 쓸 말. 카테고리·태그는 '이름' 이다. */
  sourceLabel?: string;
}

export default function SlugField({ value, onChange, source, sourceLabel = '제목' }: Props) {
  const derived = slugify(source);

  return (
    <Field label="주소(slug)" hint="비워두면 임의의 주소가 자동으로 만들어집니다.">
      <div className="join w-full">
        <input
          className="input input-bordered input-sm join-item w-full font-mono"
          value={value}
          maxLength={200}
          placeholder="자동 생성"
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm join-item"
          disabled={!derived}
          title={derived ? `${derived} 로 채웁니다` : `${sourceLabel}을 먼저 입력하세요`}
          onClick={() => onChange(derived)}
        >
          {sourceLabel}에서
        </button>
      </div>
    </Field>
  );
}
