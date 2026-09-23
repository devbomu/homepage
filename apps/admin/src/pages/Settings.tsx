import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { adminApi } from '../lib/api';
import { Card, ErrorNotice, Field, Loading, PageHeader } from '../components/ui';

/** 편집 화면에 노출할 설정들. 값은 전부 JSON 으로 저장된다. */
const FIELDS = [
  { key: 'site.title', label: '사이트 제목', hint: '브라우저 탭과 헤더에 나옵니다.' },
  { key: 'site.description', label: '사이트 설명', hint: '검색 결과와 RSS 에 쓰입니다.' },
  { key: 'site.author', label: '작성자 이름' },
  { key: 'site.locale', label: '언어', hint: '예: ko' },
] as const;

export default function Settings() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [social, setSocial] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: () => adminApi.settings.get().then((r) => r.data),
  });

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const field of FIELDS)
      next[field.key] = typeof data[field.key] === 'string' ? (data[field.key] as string) : '';
    setValues(next);
    setSocial(JSON.stringify(data['site.social'] ?? {}, null, 2));
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { ...values };
      // 소셜 링크만 구조가 있어 JSON 으로 직접 편집한다.
      payload['site.social'] = JSON.parse(social || '{}');
      return adminApi.settings.update(payload);
    },
    onSuccess: () => {
      setSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  let socialError: string | null = null;
  try {
    JSON.parse(social || '{}');
  } catch {
    socialError = 'JSON 형식이 올바르지 않습니다.';
  }

  if (isLoading) return <Loading />;

  return (
    <>
      <PageHeader
        title="설정"
        description={
          savedAt
            ? `${savedAt.toLocaleTimeString('ko-KR')} 에 저장됨`
            : '공개 사이트에 바로 반영됩니다.'
        }
        actions={
          <button
            className="btn btn-primary btn-sm"
            disabled={save.isPending || socialError != null}
            onClick={() => save.mutate()}
          >
            저장
          </button>
        }
      />

      <ErrorNotice error={error ?? save.error} />

      <Card className="max-w-2xl space-y-4">
        {FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            hint={'hint' in field ? field.hint : undefined}
          >
            <input
              className="input input-bordered input-sm w-full"
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            />
          </Field>
        ))}

        <Field label="소셜 링크" hint='예: {"github": "https://github.com/devbomu"}'>
          <textarea
            className={`textarea textarea-bordered w-full font-mono text-sm ${socialError ? 'textarea-error' : ''}`}
            rows={5}
            value={social}
            onChange={(e) => setSocial(e.target.value)}
            spellCheck={false}
          />
          {socialError && <span className="text-error mt-1 block text-xs">{socialError}</span>}
        </Field>
      </Card>
    </>
  );
}
