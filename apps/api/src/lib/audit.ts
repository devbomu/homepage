import { adminAuditLog, type Db } from '@namsu/db';

import { actorOf, type AdminIdentity } from '../env';

/**
 * 관리자 행위 기록.
 *
 * 공개 저장소 + 인터넷에 열린 관리자 화면이라, 나중에 "이거 누가 언제 바꿨지"에
 * 답할 수 있어야 한다. actor 는 Cloudflare Access 가 검증한 값만 들어간다.
 *
 * 감사 로그 실패가 본 작업을 되돌리게 하지는 않는다 — 기록은 부수적이다.
 */
export async function audit(
  db: Db,
  identity: AdminIdentity,
  action: string,
  entityType: string,
  entityId: string | number | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      actor: actorOf(identity),
      action,
      entityType,
      entityId: entityId == null ? null : String(entityId),
      detail,
    });
  } catch (error) {
    console.error('audit log failed', { action, entityType, entityId, error: String(error) });
  }
}
