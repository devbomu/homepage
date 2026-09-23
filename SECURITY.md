# 보안 취약점 제보

## 제보 방법

**공개 이슈로 올리지 말아 주세요.** 고치기 전에 알려지면 그 사이에 악용될 수 있습니다.

GitHub 의 [Private vulnerability reporting](https://github.com/devbomu/homepage/security/advisories/new) 으로 알려주시면 됩니다.
비공개로 전달되고, 확인 후 함께 공개 시점을 정할 수 있습니다.

가능하면 아래를 포함해 주세요.

- 재현 방법 (요청 예시가 있으면 가장 좋습니다)
- 영향 범위 — 무엇을 읽거나 바꿀 수 있는지
- 발견한 버전 또는 커밋

## 다루는 범위

이 저장소는 개인 홈페이지이며 상용 서비스가 아닙니다. 보증이나 대응 기한을 약속하지 않지만,
아래에 해당하면 받는 대로 확인하겠습니다.

- 관리자 인증 우회 (`api.namsu.kim/v1/admin/*`, `admin.namsu.kim`)
- 저장형 XSS — 글 본문이나 댓글을 통한 스크립트 실행
- 다른 방문자의 데이터 노출 (댓글 작성자 이메일 등)
- 레이트리밋이나 봇 차단을 무력화하는 경로

## 범위 밖

- `www.namsu.kim` 에 대한 부하·DoS 시험 — **하지 말아 주세요**
- 자동 스캐너 결과만 붙여넣은 제보 (실제 영향을 확인해 주세요)
- 보안 헤더 부재 그 자체 (실제 악용 경로가 있다면 환영합니다)
- 제3자 서비스(Cloudflare 등) 자체의 문제 — 해당 업체로 제보해 주세요

## 이 저장소가 공개인 이유

코드가 공개라고 보안이 약해지지는 않습니다. 이 프로젝트의 보안은 코드 은닉이 아니라
아래에 기대고 있습니다.

- 관리자 인증은 Cloudflare Access 의 서명 검증 ([apps/api/src/lib/access.ts](apps/api/src/lib/access.ts))
- 비밀값은 전부 런타임 시크릿. 저장소에 들어가지 않습니다
- 마크다운 렌더는 원시 HTML 이스케이프 + URL 스킴 검사 ([apps/api/src/lib/markdown.ts](apps/api/src/lib/markdown.ts))
- 남용 방어는 엣지 레이트리밋

무엇이 어떻게 막혀 있는지는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 에 적혀 있습니다.
