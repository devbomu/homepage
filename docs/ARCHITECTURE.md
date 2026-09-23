# 설계 기록

이 문서는 **무엇을 골랐는지보다 무엇을 버렸는지**를 남긴다.
나중에 "왜 이렇게 했지" 싶을 때 같은 길을 다시 헤매지 않기 위함이다.

## 최종 구성

```
www.namsu.kim    Astro           공개 사이트 (SSG + 필요한 곳만 SSR)
admin.namsu.kim  Vite + React    관리자 SPA, Cloudflare Access 뒤
api.namsu.kim    Hono            REST API
                 D1              데이터 (SQLite)
                 R2              이미지/첨부
                 Access          관리자 인증
                 Turnstile       댓글·좋아요 봇 차단
```

전부 Cloudflare Workers. 배포는 GitHub Actions → `wrangler deploy`.

## 검토했다가 버린 것들

### GitHub Pages + 정적 사이트

처음 요구사항은 GitHub Pages 배포였다. 하지만 관리자 페이지·좋아요·댓글은
서버와 DB 를 필요로 하고, Pages 는 정적 파일만 서빙한다.
댓글을 Giscus(GitHub Discussions)로 넘기면 가능했지만
**댓글 작성에 GitHub 계정이 필요해져서** 일반 독자를 받을 수 없다.

### Go 백엔드 + Cloudflare D1

Go 로 API 를 짜고 D1 을 쓰려 했으나, **D1 은 Workers 런타임 바인딩 전용**이다.
외부 Go 서버에서는 REST API 로만 접근 가능한데:

- Cloudflare 전역 API 레이트리밋(계정당 1,200 req / 5분)을 공유한다
- 매 쿼리가 HTTPS 왕복이라 레이턴시가 붙는다
- 커넥션 풀·트랜잭션 개념이 없고 `database/sql` 드라이버도 없다

→ Go 를 쓰려면 Postgres 로 가야 했다.

### 집 노트북 + Cloudflare Tunnel

우분투를 올린 노트북(4GB RAM)에 Go + Postgres 를 두고 Tunnel 로 노출하는 안.
동작은 하지만 감수할 것이 많았다.

- RAM 3.7GB 에 맞춘 Postgres 튜닝
- 노트북 가동률에 사이트가 묶임 → ISR 캐시로 우회하는 추가 설계
- 공개 저장소라 self-hosted GitHub runner 를 쓸 수 없어(포크 PR 이 집 노트북에서 코드를 실행할 수 있다)
  풀 방식 배포 파이프라인을 따로 만들어야 함

월 $5 로 전부 사라지는 복잡도였다.

### Cloud Run + 집 노트북 Postgres

컴퓨트와 DB 를 터널로 갈라놓는 구성. 두 방식의 단점만 합쳐진다.
터널 유지를 위해 `min-instances=1` 이 필요해지는 순간 Cloud Run 무료 티어의
의미가 사라지고, 쿼리마다 20~40ms 가 붙으며, 장애 지점은 둘이 된다.

### Hetzner VPS

월 5천 원대로 4GB RAM 전용 서버를 얻는 안. 가성비는 최고지만
**저가 라인이 EU 리전 전용**이라 한국에서 왕복 250ms 이고, 조사 시점에 품절이었다.

### Express (Workers 위)

2026-08-04 부터 Workers 는 Node.js 호환이 기본 활성화라 Express 도 돈다.
하지만 폴리필 계층을 거치고, D1 바인딩(`env.DB`)을 핸들러로 넘길 구조가 아니라
전역변수 우회가 필요하다. Hono 는 이게 기본 설계(`c.env.DB`)라 Hono 를 골랐다.

### Next.js

프런트를 Next 로 하려 했으나 OpenNext 변환 계층이 필요하고,
API 에서 글을 읽어오는 블로그에는 App Router·Server Actions·ISR 의 이점이 작다.
Astro 는 `@astrojs/cloudflare` 로 네이티브 배포된다. Express 를 버린 것과 같은 이유다.

관리자도 Next 대신 Vite + React SPA 로 갔다. **인증 뒤에 있는 CRUD 화면에 SSR 이 주는 이점이 없다.**

### Supabase

Postgres + Auth + Storage 를 한 번에 주지만 **무료 플랜은 7일 무활동 시 프로젝트가 정지**된다.
개인 블로그에는 현실적인 지뢰다.

## 관리자 인증을 직접 짜지 않는 이유

`admin.namsu.kim` 과 `api.namsu.kim/v1/admin/*` 을 Cloudflare Access 정책으로 감싼다.
Access 가 Google SSO 로 신원 확인을 끝낸 뒤 `Cf-Access-Jwt-Assertion` 헤더에
서명된 JWT 를 실어 보내고, API 는 그 서명만 검증한다.

얻는 것:

- 비밀번호 해싱·세션 관리·2FA 코드가 이 저장소에 존재하지 않는다 (공개 저장소에서 중요하다)
- 관리자 화면이 인증 없이는 네트워크 레벨에서 아예 도달 불가능하다
- 무료다 (50명까지)

전제: **API 의 관리자 경로도 반드시 Access 뒤에 있어야 한다.**
프런트만 막고 API 를 열어두면 의미가 없다.
서버는 여기에 더해 JWT 의 이메일이 허용 목록에 있는지 2차 검증한다.

## 개인정보 최소수집

공개 저장소이기도 하고, 필요 없는 데이터를 들고 있을 이유도 없다.

- **IP 원문을 저장하지 않는다.** 좋아요 중복 방지와 레이트리밋에는
  `sha256(ip + user-agent + 서버 솔트)` 해시면 충분하다.
- **댓글 이메일은 응답에 절대 싣지 않는다.** 답글 알림과 아바타 해시 용도로만 쓰고,
  공개 API 쿼리에서는 아예 SELECT 하지 않는다.
- 로그에 쿼리스트링 값과 IP 를 남기지 않는다.

## 알려진 제약

- **FTS5 trigram 은 2글자 이하 질의를 매칭하지 못한다.** 쿼리 계층에서 `LIKE` 스캔으로 폴백한다.
  글이 수천 개를 넘어가면 재검토가 필요하다.
- **`schema.ts` 와 `0001_triggers_and_search.sql` 이 갈라질 수 있다.**
  drizzle-kit 이 트리거·가상 테이블을 모르기 때문이다. 스키마를 고칠 때 이 파일도 같이 봐야 한다.
- **D1 무료 플랜은 하루 500만 row read / 10만 row write** 한도가 있고 초과하면 쿼리가 실패한다.
  Workers Paid 로 올리면 사실상 해제된다.
