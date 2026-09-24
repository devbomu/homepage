import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi } from '../lib/api';
import type { Project } from '../lib/types';
import SlugField from '../components/SlugField';
import SortableList from '../components/SortableList';
import MarkdownEditor from '../components/MarkdownEditor';
import { Card, EmptyState, ErrorNotice, Field, Loading, PageHeader } from '../components/ui';

export default function Projects() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => adminApi.projects.list().then((r) => r.data),
  });

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    setEditing(null);
    setCreating(false);
  };

  const remove = useMutation({
    mutationFn: (id: number) => adminApi.projects.remove(id),
    onSuccess: done,
  });

  /* 순서는 화면에서 먼저 바뀐다. 실패하면 다시 받아와 원래대로 돌아간다. */
  const reorder = useMutation({
    mutationFn: (ids: number[]) => adminApi.projects.reorder(ids),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  if (isLoading) return <Loading />;

  return (
    <>
      <PageHeader
        title="프로젝트"
        description="포트폴리오에 보여줄 항목입니다."
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setCreating(true);
              setEditing(null);
            }}
          >
            프로젝트 추가
          </button>
        }
      />

      <ErrorNotice error={error ?? remove.error ?? reorder.error} />

      {(creating || editing) && (
        <ProjectForm
          key={editing?.id ?? 'new'}
          project={editing}
          onDone={done}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {!data || data.length === 0 ? (
        <EmptyState message="프로젝트가 없습니다." />
      ) : (
        <Card className="p-0">
          <p className="text-base-content/50 border-base-300 border-b px-4 py-2 text-xs">
            끌어서 순서를 바꿉니다. 공개 사이트의 프로젝트 목록에 이 차례로 나옵니다.
          </p>
          <SortableList
            items={data}
            getId={(project) => project.id}
            onReorder={(ids) => reorder.mutate(ids)}
            disabled={data.length < 2}
            renderItem={(project, handle) => (
              <div className="border-base-300 flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
                <span className="w-6 shrink-0 text-center">{handle}</span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{project.title}</p>
                  {project.summary && (
                    <p className="text-base-content/50 truncate text-xs">{project.summary}</p>
                  )}
                </div>

                {project.isFeatured && <span className="badge badge-primary badge-sm">대표</span>}
                <span
                  className={`badge badge-sm ${project.isPublished ? 'badge-success' : 'badge-ghost'}`}
                >
                  {project.isPublished ? '공개' : '비공개'}
                </span>

                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => {
                    setEditing(project);
                    setCreating(false);
                  }}
                >
                  수정
                </button>
                <button
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => {
                    if (confirm(`"${project.title}" 을(를) 삭제할까요?`)) remove.mutate(project.id);
                  }}
                >
                  삭제
                </button>
              </div>
            )}
          />
        </Card>
      )}
    </>
  );
}

function ProjectForm({
  project,
  onDone,
  onCancel,
}: {
  project: Project | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: project?.title ?? '',
    slug: project?.slug ?? '',
    summary: project?.summary ?? '',
    description: project?.description ?? '',
    repoUrl: project?.repoUrl ?? '',
    demoUrl: project?.demoUrl ?? '',
    thumbnailUrl: project?.thumbnailUrl ?? '',
    techStack: (project?.techStack ?? []).join(', '),
    role: project?.role ?? '',
    startedOn: project?.startedOn ?? '',
    endedOn: project?.endedOn ?? '',
    isFeatured: project?.isFeatured ?? false,
    isPublished: project?.isPublished ?? false,
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        slug: form.slug || null,
        summary: form.summary || null,
        repoUrl: form.repoUrl || null,
        demoUrl: form.demoUrl || null,
        thumbnailUrl: form.thumbnailUrl || null,
        role: form.role || null,
        startedOn: form.startedOn || null,
        endedOn: form.endedOn || null,
        techStack: form.techStack
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      return project ? adminApi.projects.update(project.id, body) : adminApi.projects.create(body);
    },
    onSuccess: onDone,
  });

  return (
    <Card className="mb-4 space-y-4">
      <h2 className="font-semibold">{project ? '프로젝트 수정' : '프로젝트 추가'}</h2>
      <ErrorNotice error={save.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="제목" required>
          <input
            className="input input-bordered input-sm w-full"
            value={form.title}
            maxLength={200}
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>
        <SlugField
          value={form.slug}
          onChange={(next) => set('slug', next)}
          source={form.title}
          currentSlug={project?.slug}
        />
      </div>

      <Field label="한 줄 소개">
        <input
          className="input input-bordered input-sm w-full"
          value={form.summary}
          maxLength={500}
          onChange={(e) => set('summary', e.target.value)}
        />
      </Field>

      <MarkdownEditor
        label="설명 (마크다운)"
        value={form.description}
        onChange={(next) => set('description', next)}
        minHeight="min-h-40"
        placeholder="프로젝트 설명을 마크다운으로 작성합니다."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="저장소 주소">
          <input
            className="input input-bordered input-sm w-full"
            value={form.repoUrl}
            onChange={(e) => set('repoUrl', e.target.value)}
            placeholder="https://github.com/…"
          />
        </Field>
        <Field label="데모 주소">
          <input
            className="input input-bordered input-sm w-full"
            value={form.demoUrl}
            onChange={(e) => set('demoUrl', e.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>

      <Field label="기술 스택" hint="쉼표로 구분합니다. 예: TypeScript, Hono, D1">
        <input
          className="input input-bordered input-sm w-full"
          value={form.techStack}
          onChange={(e) => set('techStack', e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="역할">
          <input
            className="input input-bordered input-sm w-full"
            value={form.role}
            maxLength={100}
            onChange={(e) => set('role', e.target.value)}
          />
        </Field>
        <Field label="시작일">
          <input
            type="date"
            className="input input-bordered input-sm w-full"
            value={form.startedOn}
            onChange={(e) => set('startedOn', e.target.value)}
          />
        </Field>
        <Field label="종료일" hint="비워두면 진행 중">
          <input
            type="date"
            className="input input-bordered input-sm w-full"
            value={form.endedOn}
            onChange={(e) => set('endedOn', e.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={form.isPublished}
            onChange={(e) => set('isPublished', e.target.checked)}
          />
          <span className="label-text text-sm">공개</span>
        </label>
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={form.isFeatured}
            onChange={(e) => set('isFeatured', e.target.checked)}
          />
          <span className="label-text text-sm">대표 프로젝트 (첫 화면에 노출)</span>
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          취소
        </button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!form.title.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          저장
        </button>
      </div>
    </Card>
  );
}
