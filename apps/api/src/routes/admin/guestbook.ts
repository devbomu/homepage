import { COMMENT_STATUSES, createDb } from '@namsu/db';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../../env';
import { audit } from '../../lib/audit';
import { decodeCursor, parseLimit } from '../../lib/pagination';
import { noContent, ok, paged } from '../../lib/response';
import {
  listGuestbookForModeration,
  restoreGuestbookEntry,
  setGuestbookStatus,
  softDeleteGuestbookEntry,
} from '../../queries/guestbook';

export const adminGuestbook = new Hono<AppEnv>();

/** GET /v1/admin/guestbook?status=approved */
adminGuestbook.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const limit = parseLimit(c.req.query('limit'));
  const statusParam = c.req.query('status');
  const status = COMMENT_STATUSES.find((s) => s === statusParam);

  const page = await listGuestbookForModeration(db, {
    limit,
    cursor: decodeCursor(c.req.query('cursor')),
    status,
  });

  return paged(c, page.items, { limit, nextCursor: page.nextCursor, hasMore: page.hasMore });
});

/** PATCH /v1/admin/guestbook/:id — 스팸 처리와 되돌리기. */
adminGuestbook.patch(
  '/:id{[0-9]+}',
  zValidator('json', z.object({ status: z.enum(COMMENT_STATUSES) })),
  async (c) => {
    const db = createDb(c.env.DB);
    const id = Number(c.req.param('id'));
    const { status } = c.req.valid('json');

    const updated = await setGuestbookStatus(db, id, status);
    await audit(db, c.get('identity'), 'guestbook.moderate', 'guestbook', id, { status });
    return ok(c, updated);
  },
);

/** DELETE /v1/admin/guestbook/:id — 소프트 삭제. */
adminGuestbook.delete('/:id{[0-9]+}', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  await softDeleteGuestbookEntry(db, id);
  await audit(db, c.get('identity'), 'guestbook.delete', 'guestbook', id);
  return noContent(c);
});

/** POST /v1/admin/guestbook/:id/restore — 삭제한 글 되살리기. */
adminGuestbook.post('/:id{[0-9]+}/restore', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  const restored = await restoreGuestbookEntry(db, id);
  await audit(db, c.get('identity'), 'guestbook.restore', 'guestbook', id);
  return ok(c, restored);
});
