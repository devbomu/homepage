# 배포 준비

Cloudflare 계정과 `namsu.kim` 도메인이 이미 있다는 전제로 쓴다.
한 번만 하면 되고, 이후에는 `main` 에 푸시하는 것으로 끝난다.

> 이 문서에 실제 비밀값을 적지 말 것. 공개 저장소다.
> 아래 명령이 만드는 값은 전부 Cloudflare 와 GitHub 쪽에만 남는다.

## 시작 전

**모든 명령은 저장소 루트에서 실행한다.**
`wrangler` 는 전역 설치가 아니라 이 저장소의 의존성이라, 밖에서는 아예 동작하지 않는다.
`pnpm db:*` 같은 루트 스크립트는 하위 디렉터리에서도 실패한다.

```bash
cd /경로/Homepage
pnpm install
```

그다음 Cloudflare 에 로그인한다. 브라우저가 열리고 계정 권한을 묻는다.

```bash
pnpm --filter @namsu/api exec wrangler login
```

확인:

```bash
pnpm --filter @namsu/api exec wrangler whoami
```

`You are not authenticated` 가 나오면 아래 명령들이 전부 실패한다.

## 0. Workers Paid

월 $5. 무료 플랜의 요청당 CPU 10ms 제한 때문에 필요하다.
Astro 의 SSR 렌더가 그 안에 들어가지 않는다.

## 1. D1 데이터베이스

```bash
pnpm --filter @namsu/db exec wrangler d1 create namsu-kim
```

출력된 `database_id` 를 **두 곳**의 `00000000-0000-0000-0000-000000000000` 자리에 넣는다.

- `packages/db/wrangler.jsonc`
- `apps/api/wrangler.jsonc`

이 값은 비밀이 아니다. API 토큰 없이는 접근할 수 없다.

스키마를 올린다.

```bash
pnpm db:migrate:remote
```

## 2. R2 버킷 (이미지·첨부)

```bash
pnpm --filter @namsu/api exec wrangler r2 bucket create namsu-media
```

대시보드에서 이 버킷에 **공개 접근용 커스텀 도메인**(`media.namsu.kim`)을 연결한다.
`apps/api/wrangler.jsonc` 의 `MEDIA_PUBLIC_BASE_URL` 이 그 주소와 같아야 한다.

## 3. KV 네임스페이스 (세션)

Astro 의 Cloudflare 어댑터가 세션 저장소로 KV 바인딩을 요구한다.
이 사이트는 세션을 쓰지 않지만 바인딩 자체는 있어야 배포가 된다.

```bash
pnpm --filter @namsu/web exec wrangler kv namespace create SESSION
```

출력된 `id` 를 `apps/web/wrangler.jsonc` 의 `kv_namespaces` 에 넣는다.

## 4. Cloudflare Access (관리자 인증)

Zero Trust 대시보드 → Access → Applications → **Self-hosted**.

### 대상

**공개 호스트 이름**으로 두 개를 추가한다. (기본으로 잡혀 있는 `Workers` 대상은 지운다 —
`*.workers.dev` 는 아래 설명대로 아예 만들지 않는다.)

| 하위 도메인 | 도메인      | 경로       |
| ----------- | ----------- | ---------- |
| `admin`     | `namsu.kim` | _(비움)_   |
| `api`       | `namsu.kim` | `v1/admin` |

두 번째가 빠지면 **관리자 API 가 인터넷에 열린 채로 남는다.**
반대로 `api.namsu.kim` 전체에 걸면 공개 사이트가 글을 읽지 못한다. 경로를 반드시 넣을 것.

> **`*.workers.dev` 를 끈 이유**
> Access 는 호스트 이름 단위로 적용된다. 커스텀 도메인만 정책으로 감싸도
> Worker 의 `*.workers.dev` 주소는 그대로 열려 있다.
> 그래서 세 앱 모두 `wrangler.jsonc` 에 `workers_dev: false`, `preview_urls: false` 를 둔다.

### 정책

**새 정책 만들기** → 작업 `Allow`, 규칙 포함 `이메일` → 본인 이메일.
정책은 기본이 거부라 이 하나면 충분하다.

### 인증

- **사용 가능한 모든 ID 공급자 수락** 은 켠 채로 둔다.
  IdP 를 따로 붙이지 않았으면 Cloudflare 기본 **One-time PIN**(이메일 코드)이 쓰인다.
- **즉시 인증 적용** 을 켠다. 로그인 방법이 하나뿐일 때 공급자 선택 화면을 건너뛴다.

### 세부 정보

이름은 알아보기 쉬운 것으로, 세션 지속 시간은 기본값 `24 hours` 로 둔다.

### 만든 뒤

앱 상세에서 두 값을 가져와 `apps/api/wrangler.jsonc` 의 `vars` 에 넣는다. 둘 다 비밀이 아니다.

```jsonc
"CF_ACCESS_TEAM_DOMAIN": "<팀이름>.cloudflareaccess.com",
"CF_ACCESS_AUD": "<Application Audience (AUD) Tag>"
```

### 왜 관리자는 API 를 직접 부르지 않는가

`admin.namsu.kim` 과 `api.namsu.kim` 은 서로 다른 오리진이라 Access 쿠키가 공유되지 않는다.
그래서 관리자 Worker 가 `/api/*` 를 받아 API 로 넘기면서, Access 가 주입한
`Cf-Access-Jwt-Assertion` 헤더를 함께 전달한다 ([apps/admin/worker/index.ts](../apps/admin/worker/index.ts)).

## 5. Turnstile (댓글 봇 차단)

대시보드 → Turnstile → 위젯 추가. 도메인은 `namsu.kim`.

- **Site Key** → `apps/web/.env.production` 의 `PUBLIC_TURNSTILE_SITE_KEY`
  (브라우저에 노출되는 값이라 커밋해도 된다)
- **Secret Key** → 아래 6번에서 시크릿으로 넣는다

## 6. API 시크릿

```bash
# 방문자 식별 해시의 솔트. 한 번 정하면 바꾸지 않는다.
# 바꾸면 기존 좋아요가 전부 "다른 사람이 누른 것"으로 보인다.
openssl rand -hex 32 | pnpm --filter @namsu/api exec wrangler secret put VISITOR_HASH_SALT

pnpm --filter @namsu/api exec wrangler secret put TURNSTILE_SECRET_KEY
pnpm --filter @namsu/api exec wrangler secret put ADMIN_EMAILS   # 쉼표로 여러 개 가능
```

`ADMIN_EMAILS` 는 Access 정책이 잘못 열렸을 때를 대비한 2차 방어선이다.
운영 환경에서 이 셋 중 하나라도 비어 있으면 API 가 요청을 받지 않고 503 을 돌려준다
([apps/api/src/index.ts](../apps/api/src/index.ts) 의 기동 점검).

## 7. GitHub Actions 시크릿

저장소 Settings → Secrets and variables → Actions.

| 이름                    | 어디서                                                                  |
| ----------------------- | ----------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | 대시보드 → My Profile → API Tokens → **Edit Cloudflare Workers** 템플릿 |
| `CLOUDFLARE_ACCOUNT_ID` | Workers 개요 페이지 우측                                                |

토큰 권한은 Workers Scripts 편집, D1 편집, R2 편집이면 충분하다.
Zone 권한까지 줄 필요는 없다.

## 8. 첫 배포

순서가 있다. API 가 먼저 떠야 나머지가 데이터를 읽을 수 있다.

```bash
pnpm --filter @namsu/api deploy
pnpm --filter @namsu/web deploy
pnpm --filter @namsu/admin deploy
```

각 `wrangler.jsonc` 의 `routes` 에 커스텀 도메인이 적혀 있어 DNS 레코드는 자동으로 생긴다.
`namsu.kim` → `www.namsu.kim` 리다이렉트는 공개 사이트 Worker 의 미들웨어가 처리한다.
대시보드 설정은 필요 없다.

이후로는 `main` 에 푸시하면 바뀐 앱만 자동 배포된다.

## 9. 초기 데이터

관리자(`https://admin.namsu.kim`)에 들어가 **설정** 화면에서 사이트 제목·소개·소셜 링크를 채운다.
그다음 **분류** 에서 카테고리를 만들고 글을 쓰면 된다.

## 10. 알림 메일 (선택, 하지만 권장)

댓글 알림과 답글 알림을 보내려면 발송 서비스가 필요하다.
Cloudflare 의 Email Routing 은 **받기만** 하고, Email Workers 의 `send_email` 바인딩은
계정에 등록·검증한 주소로만 보낼 수 있다. 댓글 작성자는 임의의 주소이므로 여기서는 쓸 수 없다.

[Resend](https://resend.com) 를 쓴다. 무료 한도가 월 3,000통 / 일 100통이라
개인 블로그에서는 넘길 일이 없다.

1. Resend 가입 → **Domains** → `namsu.kim` 추가
2. 화면에 나오는 DKIM·SPF 레코드를 Cloudflare DNS 에 그대로 넣는다.
   **Proxy 는 반드시 꺼둔다 (DNS only).** 켜면 메일 인증이 통과하지 못한다.
3. 상태가 `Verified` 로 바뀌면 **API Keys** 에서 키를 만든다 (권한은 `Sending access` 만).
4. 키를 시크릿으로 넣는다:

```bash
cd apps/api && npx wrangler secret put RESEND_API_KEY
```

발신 주소는 비밀값이 아니라 `apps/api/wrangler.jsonc` 의 `MAIL_FROM` 에 있다.
기본값은 `namsu.kim <no-reply@namsu.kim>` 이다.

**설정하지 않아도 사이트는 정상 동작한다.** 키가 없으면 발송만 조용히 건너뛴다.
받을 주소는 `ADMIN_EMAILS` 의 첫 번째를 쓴다 (6번에서 넣은 값).

보내는 메일은 둘이다.

| 언제                       | 받는 사람                           |
| -------------------------- | ----------------------------------- |
| 새 댓글·답글이 달렸을 때   | 주인                                |
| 내 댓글에 답글이 달렸을 때 | 그 댓글 작성자 (이메일을 남긴 경우) |

비밀 댓글의 답글은 공개 화면에 내용이 나가지 않으므로, 이 메일이 답을 읽는 유일한 통로다.

## 권장 설정 (선택)

| 기능           | 왜                                                             |
| -------------- | -------------------------------------------------------------- |
| Web Analytics  | 쿠키 없는 방문 통계. GA 와 달리 개인정보 고지 부담이 없다      |
| Email Routing  | `hi@namsu.kim` → 개인 메일로 포워딩. 받는 용도 (보내기는 10번) |
| Bot Fight Mode | Turnstile 앞단에서 한 번 더 거른다                             |

## 문제가 생기면

| 증상                                            | 확인할 것                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `command not found` / `ERR_PNPM_RECURSIVE_EXEC` | 저장소 루트가 아닌 곳에서 실행했다                                                                       |
| `You are not authenticated`                     | `wrangler login` 을 안 했다                                                                              |
| API 가 503                                      | 6번 시크릿 중 빠진 것이 있다. `wrangler tail` 로 `missing required configuration` 확인                   |
| 관리자에서 401/403                              | Access 앱에 `api.namsu.kim/v1/admin` 도메인이 빠졌거나 `CF_ACCESS_AUD` 가 다르다                         |
| 댓글이 항상 거부됨                              | `TURNSTILE_SECRET_KEY` 와 `PUBLIC_TURNSTILE_SITE_KEY` 가 같은 위젯의 쌍인지 확인                         |
| 글을 고쳐도 사이트가 그대로                     | 엣지 캐시다. 최대 60초. 급하면 대시보드에서 캐시 퍼지                                                    |
| 이미지가 깨짐                                   | R2 버킷의 커스텀 도메인과 `MEDIA_PUBLIC_BASE_URL` 이 다르다                                              |
| 배포가 KV 에서 멈춤                             | 3번 KV 네임스페이스 id 를 `apps/web/wrangler.jsonc` 에 안 넣었다                                         |
| 알림 메일이 안 옴                               | `RESEND_API_KEY` 가 없거나 도메인이 아직 `Verified` 가 아니다. `wrangler tail` 로 `mail: 발송 실패` 확인 |
