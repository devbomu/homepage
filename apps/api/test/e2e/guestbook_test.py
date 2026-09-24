"""
방명록 종단 테스트.

댓글과 닮았지만 다른 점을 주로 본다.
  1. 답글이 없다 (parentId 를 받지 않는다)
  2. 승인 없이 바로 공개된다
  3. 이메일은 관리자 화면에만 보인다
  4. 삭제는 소프트 삭제이고 되살릴 수 있다
"""

import hashlib, json, urllib.parse, urllib.request, urllib.error, sys, uuid

BASE = "http://localhost:8787"
RUN = uuid.uuid4().hex[:8]
passed, failed = 0, 0


def call(method, path, body=None, persona="기본"):
    req = urllib.request.Request(BASE + urllib.parse.quote(path, safe="/%?=&"), method=method)
    req.add_header("Origin", "http://localhost:4321")
    # 방문자 해시는 IP + UA 로 만든다. 헤더는 latin-1 만 되므로 persona 를 해시한다.
    tag = hashlib.sha256(persona.encode()).hexdigest()[:8]
    req.add_header("User-Agent", f"namsu-guestbook-test/{RUN}/{tag}")
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


def write(persona, body, **extra):
    return call("POST", "/v1/guestbook", {"authorName": persona, "body": body, **extra},
                persona=persona)


print("=== 작성 ===")
s, b = call("GET", "/v1/guestbook")
check("빈 방명록 조회", s == 200 and b["data"] == [], f"{s} {b}")
check("총 개수가 meta 에 온다", b["meta"]["total"] == 0, str(b.get("meta")))

s, b = write("첫손님", f"잘 보고 갑니다 {RUN}", authorEmail="guest@example.com",
             authorWebsite="https://example.com")
check("방명록 작성", s == 201, f"{s} {b}")
first_id = b["data"]["id"]
check("승인 없이 바로 공개", b["data"]["status"] == "approved", str(b["data"]))
check("화면이 그릴 값이 응답에 있다",
      b["data"]["authorName"] == "첫손님" and b["data"]["body"].startswith("잘 보고"),
      str(b["data"]))

s, b = write("둘째손님", f"반갑습니다 {RUN}")
check("두 번째 작성", s == 201, f"{s} {b}")

print("\n=== 공개 조회 ===")
s, b = call("GET", "/v1/guestbook")
rows = b["data"] if s == 200 else []
raw = json.dumps(b, ensure_ascii=False)
check("두 건이 보인다", len(rows) == 2, str(len(rows)))
check("최신순", rows[0]["authorName"] == "둘째손님", str([r["authorName"] for r in rows]))
check("총 개수도 맞는다", b["meta"]["total"] == 2, str(b.get("meta")))
check("이메일은 응답에 없다", "authorEmail" not in raw)
check("guest@example.com 이 새지 않는다", "guest@example.com" not in raw)
check("홈페이지는 공개된다", rows[1]["authorWebsite"] == "https://example.com")

print("\n=== 입력 검사 ===")
s, b = call("POST", "/v1/guestbook", {"authorName": "", "body": "내용"})
check("이름이 비면 400", s == 400, f"{s} {b}")
s, b = call("POST", "/v1/guestbook", {"authorName": "이름", "body": ""})
check("내용이 비면 400", s == 400, f"{s} {b}")
s, b = call("POST", "/v1/guestbook", {"authorName": "이름", "body": "ㄱ" * 2001})
check("2000자를 넘으면 400", s == 400, f"{s}")
s, b = call("POST", "/v1/guestbook",
            {"authorName": "이름", "body": "내용", "authorEmail": "메일아님"}, persona="검사")
check("이메일 형식이 틀리면 400", s == 400, f"{s} {b}")
s, b = call("POST", "/v1/guestbook",
            {"authorName": "이름", "body": "내용", "authorWebsite": "주소아님"}, persona="검사2")
check("주소 형식이 틀리면 400", s == 400, f"{s} {b}")

# 답글이 없다는 것은 parentId 를 받지 않는다는 뜻이다. 보내도 무시된다.
s, b = call("POST", "/v1/guestbook",
            {"authorName": "답글시도", "body": f"답글처럼 {RUN}", "parentId": first_id},
            persona="답글시도")
check("parentId 를 보내도 그냥 새 글이 된다", s == 201, f"{s} {b}")
check("응답에 parentId 가 없다", "parentId" not in b["data"], str(b["data"]))

print("\n=== 중복 ===")
s, b = write("첫손님", f"잘 보고 갑니다 {RUN}")
check("같은 사람이 같은 내용을 또 보내면 409", s == 409, f"{s} {b}")

print("\n=== 관리자 ===")
s, b = call("GET", "/v1/admin/guestbook?status=approved")
rows = {r["id"]: r for r in (b["data"] if s == 200 else [])}
check("관리자 목록 조회", s == 200 and len(rows) >= 3, f"{s} {len(rows)}")
check("관리자 화면에는 이메일이 보인다",
      rows.get(first_id, {}).get("authorEmail") == "guest@example.com",
      str(rows.get(first_id)))

s, b = call("PATCH", f"/v1/admin/guestbook/{first_id}", {"status": "spam"})
check("스팸 처리", s == 200 and b["data"]["status"] == "spam", f"{s} {b}")
s, b = call("GET", "/v1/guestbook")
check("스팸은 공개 목록에서 사라진다",
      first_id not in [r["id"] for r in b["data"]], str([r["id"] for r in b["data"]]))
check("총 개수도 줄어든다", b["meta"]["total"] == 2, str(b.get("meta")))

s, b = call("PATCH", f"/v1/admin/guestbook/{first_id}", {"status": "approved"})
s, b = call("GET", "/v1/guestbook")
check("되돌리면 다시 보인다", first_id in [r["id"] for r in b["data"]])

print("\n=== 삭제와 되살리기 ===")
s, b = call("DELETE", f"/v1/admin/guestbook/{first_id}")
check("삭제 요청", s == 204, f"{s} {b}")
s, b = call("GET", "/v1/admin/guestbook?status=deleted")
check("삭제 탭에 나타난다", first_id in [r["id"] for r in (b["data"] if s == 200 else [])], f"{s}")
s, b = call("GET", "/v1/admin/guestbook?status=approved")
check("공개 탭에는 없다", first_id not in [r["id"] for r in (b["data"] if s == 200 else [])])
s, b = call("GET", "/v1/guestbook")
check("공개 목록에도 없다", first_id not in [r["id"] for r in b["data"]])

s, b = call("POST", f"/v1/admin/guestbook/{first_id}/restore")
check("되살리기", s == 200 and b["data"]["status"] == "approved", f"{s} {b}")
s, b = call("GET", "/v1/guestbook")
check("공개 목록으로 돌아온다", first_id in [r["id"] for r in b["data"]])
s, b = call("POST", f"/v1/admin/guestbook/{first_id}/restore")
check("이미 살아 있으면 404", s == 404, f"{s} {b}")

print("\n=== 마크다운 미리보기 (관리자 공용) ===")
s, b = call("POST", "/v1/admin/preview", {"content": "## 제목\n\n**굵게** 와 [링크](javascript:alert(1))"})
check("미리보기 렌더", s == 200 and "<h2>제목</h2>" in b["data"]["contentHtml"], f"{s} {b}")
check("javascript: 링크는 제거된다", 'href="javascript' not in b["data"]["contentHtml"])

print(f"\n통과 {passed} / 실패 {failed}")
sys.exit(1 if failed else 0)
