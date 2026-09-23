# namsu.kim

김남수의 개인 홈페이지. 블로그, 포트폴리오, 소개 페이지를 담는다.

> **공개 저장소입니다.** 비밀값은 어떤 형태로도 커밋하지 않습니다.
> 모든 자격증명은 Cloudflare Secrets 와 GitHub Secrets 로만 주입합니다.

## 구성

| 도메인 | 앱 | 스택 |
|---|---|---|
| `www.namsu.kim` | [`apps/web`](apps/web) | Astro — 공개 사이트 |
| `admin.namsu.kim` | [`apps/admin`](apps/admin) | Vite + React SPA — 글 작성/관리 |
| `api.namsu.kim` | [`apps/api`](apps/api) | Hono — REST API |

전부 Cloudflare Workers 위에서 돌아간다. 데이터는 D1(SQLite), 이미지는 R2,
관리자 인증은 Cloudflare Access, 봇 차단은 Turnstile 을 쓴다.

```
                    Cloudflare
   ┌──────────────────────────────────────────┐
   │  DNS · WAF · 캐시 · Access · Turnstile    │
   └──────┬──────────────┬──────────────┬─────┘
          │              │              │
     www (Astro)   admin (React)    api (Hono)
                                         │
                              ┌──────────┴──────────┐
                              │   D1 (SQLite)  ·  R2 │
                              └─────────────────────┘
```

자세한 설계 배경과 선택 이유는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참고.

## 왜 이 구성인가

- **변환 계층이 없다.** Astro·Hono 모두 Workers 네이티브다.
  (Next.js 는 OpenNext, Express 는 Node 폴리필이라는 계층이 하나씩 더 붙는다.)
- **관리 지점이 하나다.** 도메인·DNS·호스팅·DB·스토리지·인증이 전부 Cloudflare 한 곳에 있다.
  서버 OS 패치도, 백업 스크립트도, 배포 파이프라인용 터널도 없다.
- **인증을 직접 짜지 않는다.** Cloudflare Access 가 신원 확인을 끝내고 서명된 JWT 를 넘긴다.
  덕분에 비밀번호 해싱·세션·2FA 코드가 이 저장소에 존재하지 않는다.

## 요구 환경

- Node.js 22+
- pnpm 11+
- Cloudflare 계정 (Workers Paid $5/월 — Containers 가 아니라 CPU 시간 제한 해제 목적)

## 시작하기

```bash
pnpm install
```

로컬 D1 을 만들고 스키마와 예시 데이터를 넣는다.

```bash
pnpm db:migrate:local
pnpm db:seed:local
```

개발 서버를 띄운다.

```bash
pnpm dev
```

## 데이터베이스

스키마의 단일 진실 공급원은 [`packages/db/src/schema.ts`](packages/db/src/schema.ts) 다.

```bash
pnpm db:generate        # schema.ts 변경분으로 마이그레이션 생성
pnpm db:migrate:local   # 로컬 D1 에 적용
pnpm db:migrate:remote  # 운영 D1 에 적용
pnpm db:studio          # 스키마 탐색 UI
```

FTS5 가상 테이블과 트리거는 drizzle-kit 이 표현하지 못하므로
[`packages/db/migrations/0001_triggers_and_search.sql`](packages/db/migrations/0001_triggers_and_search.sql)
에서 손으로 관리한다. `schema.ts` 를 고쳐도 이 파일은 자동 갱신되지 않는다.

### 설계상 알아둘 것

- **다중 뎁스 카테고리** — `parent_id` 로 트리를 만들고 `path` 에 `dev/backend/go` 형태로
  조상 slug 를 머티리얼라이즈한다. 하위 트리 조회가 `LIKE 'dev/%'` 한 방에 끝나서
  재귀 CTE 없이 인덱스를 탄다.
- **자식 있는 카테고리는 삭제되지 않는다** (`ON DELETE RESTRICT`). 의도된 제약이다.
- **좋아요·댓글 수는 트리거로 비정규화**한다. 댓글 수는 `approved` 이고 삭제되지 않은 것만 센다.
- **방문자 식별은 해시만 저장**한다. `sha256(ip + user-agent + 서버 솔트)` 이고 IP 원문은 남기지 않는다.
- **검색은 FTS5 trigram 토크나이저**를 쓴다. 한국어는 공백 토큰화가 무의미해서 부분일치가 필요하다.
  대신 2글자 이하 질의는 매칭되지 않아 쿼리 계층에서 `LIKE` 로 폴백한다.

## 배포

`main` 에 푸시하면 GitHub Actions 가 변경된 앱만 골라 배포한다.

## 라이선스

코드는 MIT. 글과 이미지 등 콘텐츠는 별도이며 무단 전재를 허용하지 않는다.
