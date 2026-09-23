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
**하나의 앱에 도메인 두 개를 모두 넣는다.**

| 도메인            | 경로        |
| ----------------- | ----------- |
| `admin.namsu.kim` | (전체)      |
| `api.namsu.kim`   | `/v1/admin` |

두 번째가 빠지면 **관리자 API 가 인터넷에 열린 채로 남는다.**
`api.namsu.kim` 전체에 걸면 공개 API 까지 막히니 경로를 반드시 지정할 것.

정책은 **Allow → Emails → 본인 이메일** 하나면 충분하다.

만든 뒤 앱 상세에서 두 값을 가져와 `apps/api/wrangler.jsonc` 의 `vars` 에 넣는다.
둘 다 비밀이 아니다.

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
`namsu.kim` → `www.namsu.kim` 리다이렉트는 대시보드의 **Redirect Rules** 로 건다 (무료).

이후로는 `main` 에 푸시하면 바뀐 앱만 자동 배포된다.

## 9. 초기 데이터

관리자(`https://admin.namsu.kim`)에 들어가 **설정** 화면에서 사이트 제목·소개·소셜 링크를 채운다.
그다음 **분류** 에서 카테고리를 만들고 글을 쓰면 된다.

## 권장 설정 (선택)

| 기능           | 왜                                                        |
| -------------- | --------------------------------------------------------- |
| Web Analytics  | 쿠키 없는 방문 통계. GA 와 달리 개인정보 고지 부담이 없다 |
| Email Routing  | `hi@namsu.kim` → 개인 메일로 포워딩. 메일서버 불필요      |
| Bot Fight Mode | Turnstile 앞단에서 한 번 더 거른다                        |

## 문제가 생기면

| 증상                                            | 확인할 것                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `command not found` / `ERR_PNPM_RECURSIVE_EXEC` | 저장소 루트가 아닌 곳에서 실행했다                                                     |
| `You are not authenticated`                     | `wrangler login` 을 안 했다                                                            |
| API 가 503                                      | 6번 시크릿 중 빠진 것이 있다. `wrangler tail` 로 `missing required configuration` 확인 |
| 관리자에서 401/403                              | Access 앱에 `api.namsu.kim/v1/admin` 도메인이 빠졌거나 `CF_ACCESS_AUD` 가 다르다       |
| 댓글이 항상 거부됨                              | `TURNSTILE_SECRET_KEY` 와 `PUBLIC_TURNSTILE_SITE_KEY` 가 같은 위젯의 쌍인지 확인       |
| 글을 고쳐도 사이트가 그대로                     | 엣지 캐시다. 최대 60초. 급하면 대시보드에서 캐시 퍼지                                  |
| 이미지가 깨짐                                   | R2 버킷의 커스텀 도메인과 `MEDIA_PUBLIC_BASE_URL` 이 다르다                            |
| 배포가 KV 에서 멈춤                             | 3번 KV 네임스페이스 id 를 `apps/web/wrangler.jsonc` 에 안 넣었다                       |
