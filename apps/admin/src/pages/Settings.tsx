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

/**
 * 이미지 설정. 미디어 화면에서 올린 뒤 주소를 붙여넣는다.
 * 파비콘과 공유 카드는 쓰임새가 달라 한 장으로 겸할 수 없다 —
 * 하나는 작은 정사각형, 다른 하나는 넓은 직사각형이다.
 */
const IMAGE_FIELDS = [
  {
    key: 'site.faviconUrl',
    label: '파비콘',
    hint: '브라우저 탭과 즐겨찾기 아이콘. 정사각형 SVG 또는 512×512 PNG 를 권합니다. 비우면 기본 아이콘을 씁니다.',
    preview: 'square',
  },
  {
    key: 'site.ogImageUrl',
    label: '공유 카드 기본 이미지',
    hint: '카카오톡·슬랙·X 등에 링크를 붙였을 때 나오는 이미지. 1200×630 을 권합니다. 글에 자체 이미지가 있으면 그쪽이 우선합니다.',
    preview: 'wide',
  },
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

        <div className="divider text-base-content/50 text-xs">이미지</div>

        {IMAGE_FIELDS.map((field) => (
          <Field key={field.key} label={field.label} hint={field.hint}>
            <input
              className="input input-bordered input-sm w-full"
              placeholder="https://media.namsu.kim/…"
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            />
            {values[field.key] && (
              <img
                src={values[field.key]}
                alt=""
                className={
                  field.preview === 'square'
                    ? 'bg-base-200 mt-2 size-16 rounded-lg object-contain p-1'
                    : 'bg-base-200 mt-2 aspect-[1200/630] w-64 rounded-lg object-cover'
                }
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
          </Field>
        ))}

        <div className="divider text-base-content/50 text-xs">링크</div>

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
