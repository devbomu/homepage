import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { adminApi } from '../lib/api';
import {
  POST_STATUSES,
  POST_STATUS_LABEL,
  PROTECTED_LISTINGS,
  PROTECTED_LISTING_HINT,
  PROTECTED_LISTING_LABEL,
  type CategoryNode,
  type PostStatus,
  type ProtectedListing,
} from '../lib/types';
import SlugField from '../components/SlugField';
import MarkdownEditor from '../components/MarkdownEditor';
import { Card, ErrorNotice, Field, Loading, PageHeader } from '../components/ui';

interface Draft {
  title: string;
  slug: string;
  summary: string;
  content: string;
  categoryId: number | null;
  seriesId: number | null;
  seriesOrder: number | null;
  tagIds: number[];
  status: PostStatus;
  publishedAt: number | null;
  coverImageUrl: string;
  allowComments: boolean;
  isPinned: boolean;
  metaTitle: string;
  metaDescription: string;
  /**
   * 비밀번호 입력칸.
   *  ''        — 건드리지 않음 (기존 설정 유지)
   *  문자열    — 새 비밀번호로 잠근다
   *  removePassword — 잠금을 푼다
   */
  password: string;
  removePassword: boolean;
  protectedListing: ProtectedListing;
}

const EMPTY: Draft = {
  title: '',
  slug: '',
  summary: '',
  content: '',
  categoryId: null,
  seriesId: null,
  seriesOrder: null,
  tagIds: [],
  status: 'draft',
  publishedAt: null,
  coverImageUrl: '',
  allowComments: true,
  isPinned: false,
  metaTitle: '',
  metaDescription: '',
  password: '',
  removePassword: false,
  protectedListing: 'title',
};

/** 트리를 들여쓰기된 평면 목록으로. select 에 계층을 보여주기 위함이다. */
function flatten(nodes: CategoryNode[], depth = 0): { id: number; label: string }[] {
  return nodes.flatMap((node) => [
    { id: node.id, label: `${'  '.repeat(depth)}${depth > 0 ? '└ ' : ''}${node.name}` },
    ...flatten(node.children, depth + 1),
  ]);
}

/** unix 초 <-> datetime-local 입력값. 브라우저 로컬 시간대 기준으로 다룬다. */
function toLocalInput(seconds: number | null): string {
  if (seconds == null) return '';
  const date = new Date(seconds * 1000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export default function PostEditor() {
  const { id } = useParams();
  const postId = id ? Number(id) : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const existing = useQuery({
    queryKey: ['post', postId],
    queryFn: () => adminApi.posts.get(postId!).then((r) => r.data),
    enabled: postId != null,
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => adminApi.categories.tree().then((r) => r.data),
  });
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => adminApi.tags.list().then((r) => r.data),
  });
  const series = useQuery({
    queryKey: ['series'],
    queryFn: () => adminApi.series.list().then((r) => r.data),
  });

  // 불러온 글을 편집 상태로 옮긴다.
  useEffect(() => {
    const post = existing.data;
    if (!post) return;
    setDraft({
      title: post.title,
      slug: post.slug,
      summary: post.summary ?? '',
      content: post.content,
      categoryId: post.categoryId,
      seriesId: post.seriesId,
      seriesOrder: post.seriesOrder,
      tagIds: post.tags.map((tag) => tag.id),
      status: post.status,
      publishedAt: post.publishedAt,
      coverImageUrl: post.coverImageUrl ?? '',
      allowComments: post.allowComments,
      isPinned: post.isPinned,
      metaTitle: post.metaTitle ?? '',
      metaDescription: post.metaDescription ?? '',
      // 비밀번호는 서버가 내려주지 않는다. 걸려 있는지만 알 수 있다.
      password: '',
      removePassword: false,
      protectedListing: post.protectedListing,
    });
  }, [existing.data]);

  const categoryOptions = useMemo(() => flatten(categories.data ?? []), [categories.data]);

  /** 저장된 글에 이미 비밀번호가 걸려 있는지. 해시는 받지 않고 이 값만 온다. */
  const locked = existing.data?.hasPassword ?? false;

  const payload = () => ({
    title: draft.title,
    // 비우면 null 로 보내야 서버가 '비웠다' 와 '안 보냈다' 를 구분한다.
    slug: draft.slug || null,
    summary: draft.summary || null,
    content: draft.content,
    categoryId: draft.categoryId,
    seriesId: draft.seriesId,
    seriesOrder: draft.seriesId ? draft.seriesOrder : null,
    tagIds: draft.tagIds,
    status: draft.status,
    publishedAt: draft.publishedAt,
    coverImageUrl: draft.coverImageUrl || null,
    allowComments: draft.allowComments,
    isPinned: draft.isPinned,
    metaTitle: draft.metaTitle || null,
    metaDescription: draft.metaDescription || null,
    // 생략과 해제를 구분해야 한다. 빈 문자열을 늘 보내면 제목만 고쳐도 잠금이 풀린다.
    password: draft.removePassword ? null : draft.password || undefined,
    protectedListing: draft.protectedListing,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (postId == null) return adminApi.posts.create(payload()).then((r) => r.data);
      return adminApi.posts
        .update(postId, payload())
        .then((r) => ({ id: postId, slug: r.data.slug }));
    },
    onSuccess: (result) => {
      setSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      if (postId == null) navigate(`/posts/${result.id}`, { replace: true });
      else queryClient.invalidateQueries({ queryKey: ['post', postId] });
    },
  });

  if (postId != null && existing.isLoading) return <Loading />;

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <>
      <PageHeader
        title={postId == null ? '새 글' : '글 수정'}
        description={savedAt ? `${savedAt.toLocaleTimeString('ko-KR')} 에 저장됨` : undefined}
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/posts')}>
              목록
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={save.isPending || !draft.title.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? '저장 중…' : '저장'}
            </button>
          </>
        }
      />

      <ErrorNotice error={save.error ?? existing.error} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card className="space-y-4">
            <Field label="제목" required>
              <input
                className="input input-bordered w-full"
                value={draft.title}
                maxLength={200}
                onChange={(e) => update('title', e.target.value)}
              />
            </Field>

            <SlugField
              value={draft.slug}
              onChange={(next) => update('slug', next)}
              source={draft.title}
              currentSlug={existing.data?.slug}
            />

            <Field
              label="요약"
              hint="비워두면 본문 앞부분으로 자동 생성합니다. 목록과 검색 결과에 쓰입니다."
            >
              <textarea
                className="textarea textarea-bordered w-full"
                rows={2}
                maxLength={500}
                value={draft.summary}
                onChange={(e) => update('summary', e.target.value)}
              />
            </Field>
          </Card>

          <Card>
            <MarkdownEditor value={draft.content} onChange={(next) => update('content', next)} />
          </Card>

          <Card className="space-y-4">
            <h2 className="text-sm font-semibold">검색엔진 표시</h2>
            <Field label="메타 제목" hint="비워두면 글 제목을 씁니다.">
              <input
                className="input input-bordered input-sm w-full"
                value={draft.metaTitle}
                maxLength={200}
                onChange={(e) => update('metaTitle', e.target.value)}
              />
            </Field>
            <Field label="메타 설명" hint="비워두면 요약을 씁니다.">
              <textarea
                className="textarea textarea-bordered textarea-sm w-full"
                rows={2}
                maxLength={500}
                value={draft.metaDescription}
                onChange={(e) => update('metaDescription', e.target.value)}
              />
            </Field>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="space-y-4">
            <Field label="상태">
              <select
                className="select select-bordered select-sm w-full"
                value={draft.status}
                onChange={(e) => {
                  const status = e.target.value as PostStatus;
                  update('status', status);
                  // 발행/예약으로 바꾸면 시각이 반드시 있어야 한다 (서버 제약).
                  if (
                    (status === 'published' || status === 'scheduled') &&
                    draft.publishedAt == null
                  ) {
                    update('publishedAt', Math.floor(Date.now() / 1000));
                  }
                }}
              >
                {POST_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {POST_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>

            {(draft.status === 'published' || draft.status === 'scheduled') && (
              <Field
                label="발행 시각"
                hint={
                  draft.status === 'scheduled'
                    ? '이 시각이 지나면 자동으로 공개됩니다.'
                    : '미래로 두면 그 시각까지 공개되지 않습니다.'
                }
              >
                <input
                  type="datetime-local"
                  className="input input-bordered input-sm w-full"
                  value={toLocalInput(draft.publishedAt)}
                  onChange={(e) => update('publishedAt', fromLocalInput(e.target.value))}
                />
              </Field>
            )}

            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={draft.isPinned}
                onChange={(e) => update('isPinned', e.target.checked)}
              />
              <span className="label-text text-sm">첫 화면에 고정</span>
            </label>

            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={draft.allowComments}
                onChange={(e) => update('allowComments', e.target.checked)}
              />
              <span className="label-text text-sm">댓글 허용</span>
            </label>
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">비밀글</h2>

            {locked && !draft.removePassword && (
              <p className="text-base-content/60 flex items-center gap-2 text-xs">
                <span aria-hidden="true">🔒</span>
                비밀번호가 걸려 있습니다. 새로 입력하면 바뀝니다.
              </p>
            )}

            <Field
              label={locked ? '비밀번호 변경' : '비밀번호'}
              hint="입력하면 이 글은 비밀번호를 넣어야 본문이 열립니다. 비밀글은 댓글을 받지 않고 검색·RSS·사이트맵에서도 빠집니다."
            >
              <input
                type="password"
                className="input input-bordered input-sm w-full"
                autoComplete="new-password"
                maxLength={200}
                placeholder={locked ? '그대로 두려면 비워 두세요' : '비워 두면 공개 글입니다'}
                value={draft.password}
                disabled={draft.removePassword}
                onChange={(e) => update('password', e.target.value)}
              />
            </Field>

            {locked && (
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  className="toggle toggle-sm"
                  checked={draft.removePassword}
                  onChange={(e) => update('removePassword', e.target.checked)}
                />
                <span className="label-text text-sm">잠금 풀기 (공개 글로)</span>
              </label>
            )}

            {(locked || draft.password) && !draft.removePassword && (
              <Field
                label="목록에 보이는 방식"
                hint={PROTECTED_LISTING_HINT[draft.protectedListing]}
              >
                <select
                  className="select select-bordered select-sm w-full"
                  value={draft.protectedListing}
                  onChange={(e) => update('protectedListing', e.target.value as ProtectedListing)}
                >
                  {PROTECTED_LISTINGS.map((value) => (
                    <option key={value} value={value}>
                      {PROTECTED_LISTING_LABEL[value]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </Card>

          <Card className="space-y-4">
            <Field label="카테고리">
              <select
                className="select select-bordered select-sm w-full"
                value={draft.categoryId ?? ''}
                onChange={(e) =>
                  update('categoryId', e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">미분류</option>
                {categoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="태그">
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {(tags.data ?? []).map((tag) => {
                  const selected = draft.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={selected}
                      className={`badge ${selected ? 'badge-primary' : 'badge-ghost'} cursor-pointer`}
                      onClick={() =>
                        update(
                          'tagIds',
                          selected
                            ? draft.tagIds.filter((t) => t !== tag.id)
                            : [...draft.tagIds, tag.id],
                        )
                      }
                    >
                      {tag.name}
                    </button>
                  );
                })}
                {(tags.data ?? []).length === 0 && (
                  <span className="text-base-content/50 text-xs">
                    분류 화면에서 태그를 먼저 만들어 주세요.
                  </span>
                )}
              </div>
            </Field>

            <Field label="시리즈">
              <select
                className="select select-bordered select-sm w-full"
                value={draft.seriesId ?? ''}
                onChange={(e) => update('seriesId', e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">없음</option>
                {(series.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </Field>

            {draft.seriesId && (
              <Field label="시리즈 순서">
                <input
                  type="number"
                  min={0}
                  className="input input-bordered input-sm w-full"
                  value={draft.seriesOrder ?? ''}
                  onChange={(e) =>
                    update('seriesOrder', e.target.value ? Number(e.target.value) : null)
                  }
                />
              </Field>
            )}
          </Card>

          <Card>
            <Field label="대표 이미지 주소" hint="미디어 화면에서 올린 뒤 주소를 붙여넣습니다.">
              <input
                className="input input-bordered input-sm w-full"
                value={draft.coverImageUrl}
                onChange={(e) => update('coverImageUrl', e.target.value)}
                placeholder="https://…"
              />
            </Field>
            {draft.coverImageUrl && (
              <img
                src={draft.coverImageUrl}
                alt=""
                className="mt-3 aspect-video w-full rounded-lg object-cover"
              />
            )}
          </Card>

          {existing.data && (
            <Card className="text-base-content/60 space-y-1 text-xs">
              <p>
                {existing.data.wordCount.toLocaleString('ko-KR')}자 · {existing.data.readingMinutes}
                분
              </p>
              <p>
                조회 {existing.data.viewCount} · 좋아요 {existing.data.likeCount} · 댓글{' '}
                {existing.data.commentCount}
              </p>
              {existing.data.status === 'published' && (
                <a
                  href={`https://www.namsu.kim/blog/${encodeURIComponent(existing.data.slug)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link link-hover mt-2 inline-block"
                >
                  사이트에서 보기 ↗
                </a>
              )}
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
