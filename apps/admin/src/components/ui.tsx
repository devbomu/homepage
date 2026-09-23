import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';

import { ApiError } from '../lib/api';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && <p className="text-base-content/60 mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-base-100 rounded-xl p-5 shadow-sm ${className}`}>{children}</div>;
}

export function Loading() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label="불러오는 중">
      <span className="loading loading-spinner loading-lg"></span>
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="text-base-content/60 flex flex-col items-center gap-3 py-16 text-sm">
      <p>{message}</p>
      {action}
    </div>
  );
}

/** 에러를 읽을 수 있는 문구로 바꾼다. 필드 오류가 있으면 같이 보여준다. */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;

  const apiError = error instanceof ApiError ? error : null;
  const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';

  return (
    <div role="alert" className="alert alert-error mb-4">
      <div>
        <p className="text-sm font-medium">{message}</p>
        {apiError?.fields && (
          <ul className="mt-1 list-inside list-disc text-xs">
            {Object.entries(apiError.fields).map(([field, text]) => (
              <li key={field}>
                {field}: {text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 라벨을 붙일 수 있는 폼 컨트롤. 이것들만 htmlFor 로 명시 연결한다. */
const LABELABLE = new Set(['input', 'textarea', 'select']);

/**
 * 라벨 + 컨트롤 묶음.
 *
 * 라벨로 감싸기만 하면(암묵적 연결) 스크린리더가 이름을 못 읽는 경우가 있어,
 * 컨트롤에 id 를 심고 htmlFor 로 명시적으로 잇는다.
 * 힌트가 있으면 aria-describedby 로 함께 읽히게 한다.
 *
 * 자식이 폼 컨트롤이 아니면(예: 태그 버튼 묶음) 라벨 대신 group 으로 묶는다.
 * htmlFor 가 div 를 가리키는 것은 유효하지 않기 때문이다.
 */
export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  const child = Children.only(children);
  const isControl =
    isValidElement(child) && typeof child.type === 'string' && LABELABLE.has(child.type);

  const labelContent = (
    <>
      {label}
      {required && (
        <span className="text-error ml-0.5" aria-hidden="true">
          *
        </span>
      )}
    </>
  );

  if (!isControl) {
    return (
      <div
        className="form-control w-full"
        role="group"
        aria-label={label}
        aria-describedby={hintId}
      >
        <span className="label-text mb-1 block text-sm font-medium">{labelContent}</span>
        {child}
        {hint && (
          <span id={hintId} className="label-text-alt text-base-content/50 mt-1 block text-xs">
            {hint}
          </span>
        )}
      </div>
    );
  }

  const element = child as ReactElement<{ id?: string; 'aria-describedby'?: string }>;
  const control = cloneElement(element, {
    id: element.props.id ?? id,
    'aria-describedby': hintId ?? element.props['aria-describedby'],
  });

  return (
    <div className="form-control w-full">
      <label htmlFor={element.props.id ?? id} className="label-text mb-1 block text-sm font-medium">
        {labelContent}
      </label>
      {control}
      {hint && (
        <span id={hintId} className="label-text-alt text-base-content/50 mt-1 block text-xs">
          {hint}
        </span>
      )}
    </div>
  );
}

export function formatDate(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(seconds * 1000));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
