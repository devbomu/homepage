#!/usr/bin/env bash
#
# 실제로 기동한 Worker 를 HTTP 로 두드리는 종단 테스트.
#
# 유닛 테스트(vitest)가 순수 함수를 보는 반면, 이쪽은 라우팅·미들웨어·
# D1 쿼리·트리거·레이트리밋이 실제로 맞물려 도는지를 본다.
#
# 사용법:
#   1) 다른 터미널에서  pnpm --filter @namsu/api dev
#   2) ./test/e2e/run.sh
#
# 매 실행 전에 DB 를 시드 상태로 되돌리므로 결과가 항상 같다.
set -euo pipefail

BASE="${BASE_URL:-http://localhost:8787}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

if ! curl -sf "$BASE/health" >/dev/null 2>&1; then
  echo "API 가 $BASE 에서 응답하지 않습니다. 먼저 'pnpm --filter @namsu/api dev' 를 실행하세요." >&2
  exit 1
fi

reseed() { (cd "$ROOT" && pnpm --filter @namsu/db seed:local >/dev/null 2>&1); }

echo "▶ 공개 API"
reseed
python3 "$(dirname "${BASH_SOURCE[0]}")/public_api_test.py"

echo
echo "▶ 관리자 API"
reseed
# 모더레이션 테스트에 쓸 댓글을 하나 만들어 둔다.
curl -s -X POST "$BASE/v1/posts/hello-world/comments" \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:4321' \
  -H "User-Agent: e2e-seed-$RANDOM" \
  -d '{"authorName":"방문자","authorEmail":"visitor@example.com","body":"모더레이션 테스트용 댓글"}' >/dev/null
python3 "$(dirname "${BASH_SOURCE[0]}")/admin_api_test.py"

echo
echo "▶ 비밀 댓글 + 대댓글"
reseed
python3 "$(dirname "${BASH_SOURCE[0]}")/secret_comments_test.py"
