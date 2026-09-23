import { createDb, media } from '@namsu/db';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { actorOf, type AppEnv } from '../../env';
import { audit } from '../../lib/audit';
import { ApiError } from '../../lib/errors';
import { created, noContent, ok } from '../../lib/response';

export const adminMedia = new Hono<AppEnv>();

/** 업로드 상한. R2 는 더 큰 것도 받지만, 블로그 이미지에 10MB 면 충분하다. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * 허용 MIME 타입.
 *
 * SVG 는 뺐다 — 스크립트를 품을 수 있어서 같은 도메인에서 서빙하면 XSS 가 된다.
 * 필요해지면 별도 도메인에서 서빙하거나 래스터로 변환해 올려야 한다.
 */
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'application/pdf',
]);

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/** GET /v1/admin/media */
adminMedia.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(media).orderBy(desc(media.createdAt)).limit(100);
  return ok(c, rows);
});

/**
 * POST /v1/admin/media — multipart 업로드.
 *
 * Worker 가 R2 에 직접 쓴다. 파일이 10MB 이하라 스트리밍 업로드나
 * presigned URL 까지 갈 필요가 없다.
 */
adminMedia.post('/', async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');

  if (!(file instanceof File)) throw ApiError.badRequest('파일이 없습니다.');
  if (file.size === 0) throw ApiError.badRequest('빈 파일입니다.');
  if (file.size > MAX_UPLOAD_BYTES) throw ApiError.badRequest('파일이 너무 큽니다 (최대 10MB).');
  if (!ALLOWED_TYPES.has(file.type)) {
    throw ApiError.badRequest(`허용되지 않는 형식입니다: ${file.type || '알 수 없음'}`);
  }

  // 키는 서버가 정한다. 사용자가 준 파일명을 그대로 쓰면
  // 경로 조작이나 덮어쓰기가 가능해진다.
  const now = new Date();
  const objectKey = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${crypto.randomUUID()}.${EXTENSIONS[file.type]}`,
  ].join('/');

  await c.env.MEDIA.put(objectKey, file.stream(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  const db = createDb(c.env.DB);
  const [row] = await db
    .insert(media)
    .values({
      objectKey,
      url: `${c.env.MEDIA_PUBLIC_BASE_URL}/${objectKey}`,
      mimeType: file.type,
      sizeBytes: file.size,
      alt: typeof form?.get('alt') === 'string' ? (form.get('alt') as string) : null,
      uploadedBy: actorOf(c.get('identity')),
    })
    .returning();

  await audit(db, c.get('identity'), 'media.upload', 'media', row!.id, { objectKey });
  return created(c, row);
});

/** DELETE /v1/admin/media/:id — R2 객체와 메타데이터를 같이 지운다. */
adminMedia.delete('/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!row) throw ApiError.notFound('파일을 찾을 수 없습니다.');

  // R2 를 먼저 지운다. 여기서 실패하면 DB 행이 남아 재시도할 수 있다.
  // 반대 순서면 참조를 잃은 객체가 R2 에 영원히 남는다.
  await c.env.MEDIA.delete(row.objectKey);
  await db.delete(media).where(eq(media.id, id));

  await audit(db, c.get('identity'), 'media.delete', 'media', id, { objectKey: row.objectKey });
  return noContent(c);
});
