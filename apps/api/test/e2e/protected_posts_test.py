"""
비밀글 종단 테스트.

여기서 확인하는 규칙은 넷이다.
  1. 본문은 공개 응답에 절대 실리지 않는다 (글 페이지가 엣지에 캐시된다).
  2. 노출 방식(title/masked/hidden)에 따라 목록에 보이는 정도가 달라진다.
  3. 어느 방식이든 사이트맵·RSS·검색·관련글에는 안 나온다.
  4. 비밀번호를 맞히면 본문과 토큰이 나오고, 토큰으로 다시 열 수 있다.
"""

import json, urllib.parse, urllib.request, urllib.error, sys, uuid

BASE = "http://localhost:8787"
RUN = uuid.uuid4().hex[:8]
PASSWORD = f"open-sesame-{RUN}"
CANARY = f"CANARY{RUN}"
passed, failed = 0, 0


def call(method, path, body=None):
    req = urllib.request.Request(BASE + urllib.parse.quote(path, safe="/%?=&"), method=method)
    req.add_header("Origin", "http://localhost:4321")
    req.add_header("User-Agent", f"namsu-protected-test/{RUN}")
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


def make_post(listing, suffix):
    s, b = call("POST", "/v1/admin/posts", {
        "title": f"비밀글 {listing} {RUN}{suffix}",
        "slug": f"secret-{listing}-{RUN}{suffix}",
        "content": f"본문에만 있는 문자열 {CANARY}\n\n두 번째 문단입니다.",
        "summary": f"요약도 가려야 한다 {CANARY}",
        "coverImageUrl": "https://example.com/cover.png",
        "status": "published",
        "publishedAt": 1700000000,
        "password": PASSWORD,
        "protectedListing": listing,
    })
    assert s == 201, (s, b)
    return b["data"]["slug"], b["data"]["id"]


print("=== 비밀글 세 가지 만들기 ===")
slug_title, id_title = make_post("title", "a")
slug_masked, _ = make_post("masked", "b")
slug_hidden, _ = make_post("hidden", "c")
check("세 글 모두 생성됨", all([slug_title, slug_masked, slug_hidden]))

print("\n=== 상세 응답 ===")
s, b = call("GET", f"/v1/posts/{slug_title}")
post = b["data"] if s == 200 else {}
raw = json.dumps(b, ensure_ascii=False)
check("직접 링크로는 글이 잡힌다", s == 200, f"{s}")
check("isProtected=true", post.get("isProtected") is True)
check("본문이 null", post.get("contentHtml") is None, repr(post.get("contentHtml"))[:60])
check("요약이 null", post.get("summary") is None)
check("표지 이미지가 null", post.get("coverImageUrl") is None)
check("본문 문자열이 응답 어디에도 없다", CANARY not in raw)
check("댓글을 받지 않는다", post.get("allowComments") is False)
check("관련 글·이전다음 글이 비어 있다",
      post.get("related") == [] and post.get("previous") is None and post.get("next") is None,
      str(post.get("related")))
check("제목만 보이기는 제목이 그대로", post.get("title", "").startswith("비밀글 title"))

s, b = call("GET", f"/v1/posts/{slug_masked}")
check("제목도 가리기는 title 이 빈 문자열", b["data"]["title"] == "", repr(b["data"].get("title")))
check("제목도 가리기는 카테고리·태그도 비운다",
      b["data"]["category"] is None and b["data"]["tags"] == [])
check("isMasked=true", b["data"]["isMasked"] is True)

print("\n=== 목록 노출 ===")
s, b = call("GET", "/v1/posts?limit=50")
slugs = [p["slug"] for p in b["data"]]
by_slug = {p["slug"]: p for p in b["data"]}
check("'제목만' 은 목록에 있다", slug_title in slugs)
check("'제목도 가리기' 도 목록에 있다", slug_masked in slugs)
check("'숨기기' 는 목록에 없다", slug_hidden not in slugs, str(slugs))
check("목록에서도 요약이 비어 있다", by_slug[slug_title]["summary"] is None)
check("목록에서도 표지가 비어 있다", by_slug[slug_title]["coverImageUrl"] is None)
check("목록 응답에 본문이 없다", CANARY not in json.dumps(b, ensure_ascii=False))

print("\n=== 색인·피드·검색 ===")
s, b = call("GET", "/v1/feed/posts")
feed = [p["slug"] for p in b["data"]]
check("비밀글은 사이트맵·RSS 재료에서 전부 빠진다",
      not any(x in feed for x in (slug_title, slug_masked, slug_hidden)), str(feed))

s, b = call("GET", f"/v1/posts/search?q={RUN}")
found = [p["slug"] for p in (b["data"] if s == 200 else [])]
check("검색 결과에도 안 나온다", not any(x in found for x in (slug_title, slug_masked, slug_hidden)),
      str(found))

print("\n=== 댓글 ===")
s, b = call("GET", f"/v1/posts/{slug_title}/comments")
check("댓글 목록은 비어 있다", s == 200 and b["data"]["comments"] == [], f"{s} {b}")
check("댓글 허용도 false", s == 200 and b["data"]["allowComments"] is False)
s, b = call("POST", f"/v1/posts/{slug_title}/comments", {"authorName": "x", "body": "y"})
check("댓글 작성은 403", s == 403, f"{s} {b}")

print("\n=== 해제 ===")
s, b = call("POST", f"/v1/posts/{slug_title}/unlock", {"password": "틀린비밀번호"})
check("틀린 비밀번호는 403", s == 403, f"{s} {b}")
check("틀렸을 때 본문이 새지 않는다", CANARY not in json.dumps(b, ensure_ascii=False))

s, b = call("POST", f"/v1/posts/{slug_title}/unlock", {"password": PASSWORD})
check("맞는 비밀번호는 200", s == 200, f"{s} {b}")
data = b["data"] if s == 200 else {}
check("본문이 내려온다", CANARY in (data.get("contentHtml") or ""), repr(data.get("contentHtml"))[:80])
check("제목도 함께 온다", (data.get("title") or "").startswith("비밀글 title"))
token = data.get("token")
check("토큰이 발급된다", bool(token))

s, b = call("POST", f"/v1/posts/{slug_title}/unlock", {"token": token})
check("토큰으로 다시 열린다", s == 200 and CANARY in b["data"]["contentHtml"], f"{s}")

s, b = call("POST", f"/v1/posts/{slug_masked}/unlock", {"token": token})
check("다른 글의 토큰은 안 먹는다", s == 403, f"{s} {b}")

s, b = call("POST", f"/v1/posts/{slug_title}/unlock", {"token": "1.9999999999.forged"})
check("위조 토큰은 403", s == 403, f"{s} {b}")

s, b = call("POST", "/v1/posts/hello-world/unlock", {"password": PASSWORD})
check("비밀글이 아닌 글은 400", s == 400, f"{s} {b}")

print("\n=== 관리자 ===")
s, b = call("GET", f"/v1/admin/posts/{id_title}")
check("관리자 상세에 hasPassword", s == 200 and b["data"]["hasPassword"] is True, f"{s}")
check("해시는 내려주지 않는다", "passwordHash" not in json.dumps(b), "passwordHash 가 응답에 있음")
check("노출 방식도 함께 온다", b["data"]["protectedListing"] == "title")

s, b = call("PATCH", f"/v1/admin/posts/{id_title}", {"title": f"제목만 바꿈 {RUN}"})
check("제목만 고쳐도 잠금이 유지된다", s == 200 and b["data"]["hasPassword"] is True, f"{s} {b}")
s, b = call("GET", f"/v1/posts/{slug_title}")
check("여전히 본문이 null", b["data"]["contentHtml"] is None)

s, b = call("PATCH", f"/v1/admin/posts/{id_title}", {"password": None})
check("password=null 이면 잠금이 풀린다", s == 200 and b["data"]["hasPassword"] is False, f"{s} {b}")
s, b = call("GET", f"/v1/posts/{slug_title}")
check("잠금을 풀면 본문이 보인다", CANARY in (b["data"]["contentHtml"] or ""), "본문이 아직 없음")
check("잠금을 풀면 댓글도 다시 열린다", b["data"]["allowComments"] is True)
s, b = call("GET", "/v1/feed/posts")
check("잠금을 풀면 피드에도 다시 들어온다",
      slug_title in [p["slug"] for p in b["data"]])

print(f"\n통과 {passed} / 실패 {failed}")
sys.exit(1 if failed else 0)
