import json, urllib.parse, urllib.request, urllib.error, sys, uuid

BASE = "http://localhost:8787"
UA = f"namsu-admin-test/{uuid.uuid4()}"
passed = failed = 0

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


def call(method, path, body=None):
    req = urllib.request.Request(BASE + encode_path(path), method=method)
    req.add_header("Origin", "http://localhost:5173"); req.add_header("User-Agent", UA)
    data = None
    if body is not None:
        data = json.dumps(body).encode(); req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data) as r:
            raw = r.read().decode(); return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {"raw": raw[:300]}

def check(label, cond, detail=""):
    global passed, failed
    if cond: passed += 1; print(f"  ✅ {label}")
    else:    failed += 1; print(f"  ❌ {label}  {detail}")

def paths():
    s, b = call("GET", "/v1/admin/categories")
    out = {}
    def walk(nodes):
        for n in nodes: out[n["slug"]] = (n["path"], n["depth"]); walk(n["children"])
    if s == 200: walk(b["data"])
    return out

print("=== 인증 ===")
s, b = call("GET", "/v1/admin/me")
check("개발 환경 우회 신원", s == 200 and b["data"]["email"] == "dev@localhost", f"{s} {b}")

print("\n=== 글 작성 (마크다운 렌더 포함) ===")
s, b = call("GET", "/v1/admin/tags")
tag_ids = [t["id"] for t in b["data"][:2]] if s == 200 else []
s, b = call("POST", "/v1/admin/posts", {
    "title": "Hono와 D1로 만든 블로그 API",
    "content": "## 소개\n\n**굵게** 와 [링크](https://example.com) 그리고 [위험](javascript:alert(1)).\n\n```ts\nconst x = 1;\n```",
    "summary": "", "tagIds": tag_ids, "status": "published",
})
check("글 생성", s == 201, f"{s} {b}")
post_id = b["data"]["id"] if s == 201 else None
slug = b["data"]["slug"] if s == 201 else ""
check("한글 제목에서 slug 자동 생성", slug == "hono와-d1로-만든-블로그-api", slug)

s, b = call("GET", f"/v1/admin/posts/{post_id}")
d = b["data"] if s == 200 else {}
check("마크다운이 HTML 로 렌더됨", "<h2>소개</h2>" in (d.get("contentHtml") or ""), repr(d.get("contentHtml"))[:70])
check("javascript: 링크가 제거됨", 'href="javascript' not in (d.get("contentHtml") or ""))
check("요약 자동 생성", bool(d.get("summary")), repr(d.get("summary"))[:50])
check("읽기 시간 계산", d.get("readingMinutes", 0) >= 1, str(d.get("readingMinutes")))
check("태그 연결", len(d.get("tags", [])) == len(tag_ids), str(d.get("tags")))
check("발행 시각 자동 설정", d.get("publishedAt") is not None)

s, b = call("GET", f"/v1/posts/{slug}")
check("공개 API 에서 바로 조회됨", s == 200, str(s))
s, b = call("GET", "/v1/posts/search?q=블로그")
check("FTS 색인이 트리거로 갱신됨", s == 200 and any(p["slug"] == slug for p in b["data"]), str(s))

print("\n=== 다중 뎁스 카테고리 이동 (자손 path 연쇄 갱신) ===")
before = paths()
check("이동 전 구조", before.get("infra") == ("dev/backend/infra", 2), str(before.get("infra")))

# 'backend' 를 'dev' 아래에서 'life' 아래로 옮긴다. 자손 'infra' 도 따라가야 한다.
s, b = call("GET", "/v1/admin/categories")
ids = {}
def collect(nodes):
    for n in nodes: ids[n["slug"]] = n["id"]; collect(n["children"])
collect(b["data"])

s, b = call("PATCH", f"/v1/admin/categories/{ids['backend']}", {"parentId": ids["life"]})
check("카테고리 이동 요청", s == 200, f"{s} {b}")
after = paths()
check("본인 path 갱신", after.get("backend") == ("life/backend", 1), str(after.get("backend")))
check("자손 path 연쇄 갱신", after.get("infra") == ("life/backend/infra", 2), str(after.get("infra")))
check("무관한 카테고리는 그대로", after.get("frontend") == ("dev/frontend", 1), str(after.get("frontend")))

s, b = call("GET", "/v1/posts?category=life")
check("이동 후 새 경로로 글이 조회됨", s == 200 and len(b["data"]) == 1, f"{s} {len(b['data']) if s==200 else ''}")
s, b = call("GET", "/v1/posts?category=dev")
check("옛 경로에서는 안 나옴", s == 200 and len(b["data"]) == 0, f"{s} {len(b['data']) if s==200 else ''}")

print("\n=== slug 정규화 ===")
# slugify 는 '_' 를 '-' 로 바꾼다. 덕분에 관리자 API 로는 LIKE 와일드카드가
# slug 에 들어갈 수 없다. 이 동작이 바뀌면 taxonomy 의 ESCAPE 처리가
# 실제로 필요해지므로 여기서 고정해 둔다 (seed 쪽에 대응 테스트가 있다).
s, b = call("POST", "/v1/admin/categories", {"name": "언더바", "slug": "a_b"})
check("'_' 가 '-' 로 정규화됨", s == 201 and b["data"]["slug"] == "a-b", str(b.get("data", {}).get("slug")))
if s == 201: call("DELETE", f"/v1/admin/categories/{b['data']['id']}")

print("\n=== 카테고리 삭제 규칙 ===")
s, b = call("DELETE", f"/v1/admin/categories/{ids['backend']}")
check("자식 있으면 409 + 읽을 수 있는 메시지", s == 409 and "하위" in b["error"]["message"], f"{s} {b.get('error')}")
s, b = call("DELETE", f"/v1/admin/categories/{ids['infra']}")
check("말단은 삭제됨", s == 204, f"{s}")

print("\n=== 순환 참조 방지 ===")
s, b = call("PATCH", f"/v1/admin/categories/{ids['life']}", {"parentId": ids["backend"]})
check("자기 자손을 상위로 지정 차단", s == 422, f"{s} {b.get('error')}")
s, b = call("PATCH", f"/v1/admin/categories/{ids['life']}", {"parentId": ids["life"]})
check("자기 자신을 상위로 지정 차단", s == 422, f"{s}")

print("\n=== 댓글 모더레이션 ===")
s, b = call("GET", "/v1/admin/comments?status=pending")
pend = b["data"] if s == 200 else []
check("대기 큐 조회", s == 200 and len(pend) >= 1, f"{s} {len(pend)}")
check("관리자 화면에는 이메일이 보임", s == 200 and "authorEmail" in pend[0], str(list(pend[0].keys()))[:80] if pend else "")
cid = pend[0]["id"] if pend else None
s, b = call("PATCH", f"/v1/admin/comments/{cid}", {"status": "approved"})
check("승인 처리", s == 200 and b["data"]["status"] == "approved", f"{s}")
s, b = call("GET", "/v1/posts/hello-world/comments")
check("승인 후 공개 목록에 나타남", s == 200 and len(b["data"]["comments"]) == 1, str(s))
check("공개 응답에 이메일 없음", s == 200 and "authorEmail" not in b["data"]["comments"][0],
      str(list(b["data"]["comments"][0].keys())) if s == 200 and b["data"]["comments"] else "")
s, b = call("GET", "/v1/posts/hello-world")
check("commentCount 트리거 갱신", s == 200 and b["data"]["commentCount"] == 1, str(b["data"].get("commentCount") if s==200 else s))
s, b = call("PATCH", f"/v1/admin/comments/{cid}", {"status": "spam"})
s, b = call("GET", "/v1/posts/hello-world")
check("스팸 처리하면 카운트 원복", s == 200 and b["data"]["commentCount"] == 0, str(b["data"].get("commentCount") if s==200 else s))

print("\n=== 통계 / 감사 로그 ===")
s, b = call("GET", "/v1/admin/stats")
check("대시보드 통계", s == 200 and b["data"]["posts"]["published"] >= 1, f"{s} {b.get('data',{}).get('posts')}")
check("대기 댓글 수 포함", s == 200 and "pendingComments" in b["data"])

print("\n=== 소프트 삭제 ===")
s, b = call("DELETE", f"/v1/admin/posts/{post_id}")
check("글 소프트 삭제", s == 204, f"{s}")
s, b = call("GET", f"/v1/posts/{slug}")
check("삭제 후 공개 조회 404", s == 404, f"{s}")

print(f"\n  {passed}/{passed+failed} 통과" + ("" if failed == 0 else f"  — {failed}건 실패"))
sys.exit(1 if failed else 0)
