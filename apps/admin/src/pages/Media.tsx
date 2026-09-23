import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { adminApi } from '../lib/api';
import {
  Card,
  EmptyState,
  ErrorNotice,
  formatBytes,
  formatDate,
  Loading,
  PageHeader,
} from '../components/ui';

export default function Media() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['media'],
    queryFn: () => adminApi.media.list().then((r) => r.data),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['media'] });

  const upload = useMutation({
    mutationFn: (file: File) => adminApi.media.upload(file),
    onSuccess: () => {
      if (fileInput.current) fileInput.current.value = '';
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => adminApi.media.remove(id),
    onSuccess: invalidate,
  });

  const copy = async (id: number, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // 클립보드 접근이 막힌 환경에서는 주소를 직접 선택해 복사하면 된다.
      prompt('주소를 복사하세요', url);
    }
  };

  return (
    <>
      <PageHeader title="미디어" description="이미지는 R2 에 저장됩니다. 최대 10MB." />

      <ErrorNotice error={error ?? upload.error ?? remove.error} />

      <Card className="mb-6">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf"
          className="file-input file-input-bordered file-input-sm w-full"
          disabled={upload.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
          }}
        />
        {upload.isPending && <p className="text-base-content/60 mt-2 text-sm">올리는 중…</p>}
        <p className="text-base-content/50 mt-2 text-xs">
          SVG 는 받지 않습니다. 스크립트를 품을 수 있어 같은 도메인에서 서빙하면 위험합니다.
        </p>
      </Card>

      {isLoading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <EmptyState message="올린 파일이 없습니다." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((item) => (
            <Card key={item.id} className="space-y-3 p-3">
              {item.mimeType.startsWith('image/') ? (
                <img
                  src={item.url}
                  alt={item.alt ?? ''}
                  className="aspect-video w-full rounded-lg object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="bg-base-200 flex aspect-video items-center justify-center rounded-lg text-sm">
                  {item.mimeType}
                </div>
              )}

              <div className="text-base-content/60 space-y-0.5 text-xs">
                <p className="truncate font-mono" title={item.objectKey}>
                  {item.objectKey}
                </p>
                <p>
                  {formatBytes(item.sizeBytes)} · {formatDate(item.createdAt)}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  className="btn btn-outline btn-xs flex-1"
                  onClick={() => copy(item.id, item.url)}
                >
                  {copied === item.id ? '복사됨' : '주소 복사'}
                </button>
                <button
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => {
                    if (confirm('이 파일을 삭제할까요?\n글에서 쓰고 있다면 이미지가 깨집니다.'))
                      remove.mutate(item.id);
                  }}
                >
                  삭제
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
