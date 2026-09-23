import json, urllib.parse, urllib.request, urllib.error, sys, uuid

RUN_UA = f"namsu-api-test/{uuid.uuid4()}"

BASE = "http://localhost:8787"
passed, failed = 0, 0

def encode_path(path):
    """
    URL 을 안전하게 인코딩한다.

    '%' 를 안전 문자에 넣는 것이 핵심이다. 그래야 호출부가 이미 인코딩해 넘긴 값은
    그대로 통과하고, 생 한글만 인코딩된다. 이걸 빠뜨려 이중 인코딩이 나는 바람에
    멀쩡한 검색 기능을 두 번이나 버그로 오해했다.
    """
    if "?" in path:
        p, q = path.split("?", 1)
        return urllib.parse.quote(p, safe="/%") + "?" + urllib.parse.quote(q, safe="=&%")
    return urllib.parse.quote(path, safe="/%")


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + encode_path(path), method=method)
    req.add_header("Origin", "http://localhost:4321")
    req.add_header("User-Agent", RUN_UA)
    for k, v in (headers or {}).items(): req.add_header(k, v)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {"raw": raw[:200]}

def check(label, cond, detail=""):
    global passed, failed
    if cond: passed += 1; print(f"  ✅ {label}")
    else:    failed += 1; print(f"  ❌ {label}  {detail}")

print("=== 헬스체크 ===")
s, b = call("GET", "/health")
check("GET /health", s == 200 and b["status"] == "ok", f"{s} {b}")

print("\n=== 분류 체계 ===")
s, b = call("GET", "/v1/categories")
tree = b["data"] if s == 200 else []
check("카테고리 트리 조회", s == 200 and len(tree) == 3, f"{s} 루트 {len(tree)}개")
dev = next((n for n in tree if n["slug"] == "dev"), None)
check("2단계 중첩", dev is not None and len(dev["children"]) == 2, str(dev and len(dev["children"])))
backend = next((n for n in (dev["children"] if dev else []) if n["slug"] == "backend"), None)
check("3단계 중첩", backend is not None and len(backend["children"]) == 1)
check("path 머티리얼라이즈", backend and backend["children"][0]["path"] == "dev/backend/infra",
      backend and backend["children"][0]["path"])
check("하위 글 수가 조상에 합산됨", dev is not None and dev["postCount"] == 1, f"dev.postCount={dev and dev['postCount']}")

s, b = call("GET", "/v1/categories/dev/backend/infra")
check("슬래시 포함 path 조회", s == 200 and b["data"]["slug"] == "infra", str(s))
check("브레드크럼 3단계", s == 200 and [x["slug"] for x in b["data"]["breadcrumb"]] == ["dev","backend","infra"],
      s == 200 and str([x["slug"] for x in b["data"]["breadcrumb"]]))

s, b = call("GET", "/v1/tags")
check("태그 목록 + 글 수", s == 200 and len(b["data"]) == 4, f"{s} {len(b['data']) if s==200 else ''}")

print("\n=== 글 ===")
s, b = call("GET", "/v1/posts")
check("글 목록", s == 200 and len(b["data"]) == 2, f"{s} {len(b.get(chr(34)+'data'+chr(34), []))}건")
post = b["data"][0] if s == 200 and b["data"] else {}
check("카테고리 조인", post.get("category", {}) and post["category"]["path"] == "dev/backend/infra")
check("태그 조인 (N+1 없이)", len(post.get("tags", [])) == 2, str(post.get("tags")))
check("페이지 메타", s == 200 and b["meta"]["hasMore"] is False)

s, b = call("GET", "/v1/posts/hello-world")
check("글 상세", s == 200 and b["data"]["slug"] == "hello-world", str(s))
check("본문 HTML 렌더됨", s == 200 and "<h2>" in (b["data"]["contentHtml"] or ""),
      s == 200 and repr(b["data"]["contentHtml"])[:60])
check("브레드크럼 포함", s == 200 and len(b["data"]["breadcrumb"]) == 3)

s, b = call("GET", "/v1/posts/does-not-exist")
check("없는 글은 404", s == 404 and b["error"]["code"] == "not_found", str(s))

print("\n=== 하위 카테고리 필터 ===")
s, b = call("GET", "/v1/posts?category=dev")
check("'dev' 로 조회하면 손자 글도 나옴", s == 200 and len(b["data"]) == 1, f"{s} {len(b['data']) if s==200 else ''}")
s, b = call("GET", "/v1/posts?category=life")
check("다른 카테고리는 빈 결과", s == 200 and len(b["data"]) == 0)
s, b = call("GET", "/v1/posts?category=nope")
check("없는 카테고리는 404", s == 404)

print("\n=== 예약 발행 (회귀) ===")
# 공개 조건이 status 와 published_at 을 함께 봐야 한다.
# status 만 보면 예약은 영영 안 나오고, 미래 날짜 발행은 즉시 나온다.
s, b = call("GET", "/v1/posts")
slugs = {p["slug"] for p in b.get("data", [])}
check("시간이 지난 '예약' 글은 공개된다", "예약-지난것" in slugs, str(sorted(slugs)))
check("시간 전 '예약' 글은 숨는다", "예약-미래것" not in slugs)
check("미래 날짜의 '발행' 글도 숨는다", "발행-미래것" not in slugs)

s, _ = call("GET", "/v1/posts/예약-지난것")
check(f"시간 지난 예약 글 상세 열림 ({s})", s == 200)
s, _ = call("GET", "/v1/posts/발행-미래것")
check(f"미래 발행 글 상세는 404 ({s})", s == 404)

s, b = call("GET", "/v1/feed/posts")
feed_slugs = {p["slug"] for p in b.get("data", [])}
check("RSS 재료에도 같은 규칙 적용", "예약-지난것" in feed_slugs and "발행-미래것" not in feed_slugs,
      str(sorted(feed_slugs)))

s, b = call("GET", "/v1/feed/pages")
check(f"사이트맵용 페이지 목록 ({s})", s == 200 and isinstance(b.get("data"), list))

print("\n=== LIKE 와일드카드가 든 slug (회귀) ===")
# SQLite 는 ESCAPE 절이 없으면 백슬래시를 이스케이프 문자로 보지 않는다.
# 그 절이 빠지면 '_' 가 든 경로의 하위 조회가 조용히 빈 결과를 낸다.
s, b = call("GET", "/v1/categories/a_b")
check("'_' 포함 카테고리 조회", s == 200 and b["data"]["slug"] == "a_b", str(s))
s, b = call("GET", "/v1/posts?category=a_b")
check("'_' 포함 카테고리 하위 조회가 500/404 없이 동작", s == 200, f"{s}")
s, b = call("GET", "/v1/categories")
node = next((n for n in b["data"] if n["slug"] == "a_b"), None) if s == 200 else None
check("'_' 카테고리의 자식이 트리에 붙음", node is not None and len(node["children"]) == 1,
      str(node and len(node["children"])))

print("\n=== 검색 (한국어) ===")
for q, expect, label in [("홈페이지", 1, "3글자 이상 → FTS5"), ("개발", 0, "2글자 → LIKE 폴백"),
                          ("Cloudflare", 1, "영문 대소문자 무시"), ("파이썬", 0, "없는 말")]:
    s, b = call("GET", f"/v1/posts/search?q={urllib.parse.quote(q)}")
    check(f"{label}: '{q}' → {expect}건", s == 200 and len(b["data"]) == expect,
          f"{s} {len(b['data']) if s==200 else ''}")

print("\n=== 좋아요 ===")
s, b = call("GET", "/v1/posts/hello-world/like")
check("초기 상태", s == 200 and b["data"] == {"liked": False, "likeCount": 0}, str(b.get("data")))
s, b = call("POST", "/v1/posts/hello-world/like")
check("좋아요 누름", s == 200 and b["data"]["liked"] and b["data"]["likeCount"] == 1, str(b.get("data")))
s, b = call("POST", "/v1/posts/hello-world/like")
check("다시 누르면 취소 (토글)", s == 200 and not b["data"]["liked"] and b["data"]["likeCount"] == 0, str(b.get("data")))
call("POST", "/v1/posts/hello-world/like")
s, b = call("GET", "/v1/posts")
check("목록의 likeCount 가 트리거로 갱신됨", s == 200 and b["data"][0]["likeCount"] == 1,
      s == 200 and str(b["data"][0]["likeCount"]))

print("\n=== 댓글 ===")
s, b = call("POST", "/v1/posts/hello-world/comments",
            {"authorName": "방문자", "body": "첫 댓글입니다"})
check("댓글 등록", s == 201 and b["data"]["status"] == "approved", f"{s} {b}")
check("승인 없이 바로 공개된다는 문구", s == 201 and "확인 후" not in b["data"]["message"],
      str(b["data"].get("message")))
s, b = call("GET", "/v1/posts/hello-world/comments")
check("등록하자마자 공개 목록에 나타남", s == 200 and len(b["data"]["comments"]) == 1, str(s))
check("본문이 그대로 보임",
      s == 200 and b["data"]["comments"][0]["body"] == "첫 댓글입니다",
      str(b["data"]["comments"][:1]))

# 댓글 레이트리밋은 1분에 3회다. 아래 순서는 그 안에서 짜여 있다.
s, b = call("POST", "/v1/posts/hello-world/comments", {"authorName": "방문자", "body": "첫 댓글입니다"})
check("같은 내용 중복 등록 차단 (2/3)", s == 409, f"{s}")
s, b = call("POST", "/v1/posts/hello-world/comments", {"authorName": "", "body": "x"})
check("빈 이름 거부 (3/3)", s == 400 and "authorName" in b["error"].get("fields", {}), f"{s} {b.get('error')}")
s, b = call("POST", "/v1/posts/hello-world/comments", {"authorName": "누구", "body": "네번째"})
check("레이트리밋 초과 시 429 (4/3)", s == 429 and b["error"]["code"] == "too_many_requests", f"{s}")

print("\n=== 사이트 콘텐츠 ===")
s, b = call("GET", "/v1/settings")
check("사이트 설정", s == 200 and b["data"]["site.title"] == "namsu.kim", str(b.get("data")))
s, b = call("GET", "/v1/nav")
check("네비게이션", s == 200 and len(b["data"]) == 1 and b["data"][0]["slug"] == "about", str(s))
s, b = call("GET", "/v1/pages/about")
check("단독 페이지", s == 200 and b["data"]["title"] == "소개", str(s))
s, b = call("GET", "/v1/projects")
check("프로젝트 목록 (빈 상태)", s == 200 and b["data"] == [])

print("\n=== CORS ===")
req = urllib.request.Request(BASE + "/v1/posts", method="OPTIONS")
req.add_header("Origin", "http://localhost:4321"); req.add_header("Access-Control-Request-Method", "GET")
try:
    with urllib.request.urlopen(req) as r:
        check("허용 오리진 프리플라이트", r.status == 204 and r.headers.get("Access-Control-Allow-Origin") == "http://localhost:4321")
except urllib.error.HTTPError as e: check("허용 오리진 프리플라이트", False, str(e.code))

req = urllib.request.Request(BASE + "/v1/posts", method="OPTIONS")
req.add_header("Origin", "https://evil.example"); req.add_header("Access-Control-Request-Method", "GET")
try:
    with urllib.request.urlopen(req) as r: check("미허용 오리진 차단", False, f"통과됨 {r.status}")
except urllib.error.HTTPError as e: check("미허용 오리진 차단", e.code == 403, str(e.code))

print(f"\n  {passed}/{passed+failed} 통과" + ("" if failed == 0 else f"  — {failed}건 실패"))
sys.exit(1 if failed else 0)
