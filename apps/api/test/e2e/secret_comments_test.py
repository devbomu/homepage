"""
비밀 댓글 + 대댓글 종단 테스트.

이 두 기능은 서로 얽혀 있어서 따로 보면 안 된다. 여기서 확인하는 규칙은 셋이다.
  1. 비밀 댓글의 본문과 작성자는 공개 응답에 절대 실리지 않는다
     (글 페이지가 엣지에 캐시되므로 한 번 새면 다음 방문자에게 그대로 간다).
  2. 비밀 댓글에 달리는 답글은 누가 달든 서버가 비밀로 만든다
     (답글 한 줄만으로도 원래 질문이 짐작된다).
  3. 댓글 수는 화면에 보이는 줄 수와 같다 — 비밀 댓글도 잠금 표시로 한 줄 차지하므로 센다.
"""

import hashlib, json, urllib.parse, urllib.request, urllib.error, sys, uuid

BASE = "http://localhost:8787"
SLUG = "hello-world"
RUN = uuid.uuid4()
passed, failed = 0, 0


def call(method, path, body=None, persona="기본"):
    req = urllib.request.Request(BASE + urllib.parse.quote(path, safe="/%?=&"), method=method)
    req.add_header("Origin", "http://localhost:4321")
    # 방문자 해시는 IP + UA 로 만든다. persona 를 UA 에 섞어 서로 다른 방문자로 만든다.
    # 헤더는 latin-1 로만 보낼 수 있으므로 한글 persona 를 해시해 아스키로 바꾼다.
    tag = hashlib.sha256(persona.encode()).hexdigest()[:8]
    req.add_header("User-Agent", f"namsu-secret-test/{RUN}/{tag}")
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


def comment(persona, body, secret=False, parent=None):
    payload = {"authorName": persona, "body": body, "isSecret": secret}
    if parent is not None: payload["parentId"] = parent
    return call("POST", f"/v1/posts/{SLUG}/comments", payload, persona=persona)


def approve(cid):
    """승인 없이 바로 공개되지만, 스팸 처리했다가 되돌리는 경우를 위해 남겨 둔다."""
    return call("PATCH", f"/v1/admin/comments/{cid}", {"status": "approved"})


def tree():
    s, b = call("GET", f"/v1/posts/{SLUG}/comments")
    return b["data"]["comments"] if s == 200 else []


def flatten(nodes, out=None):
    out = [] if out is None else out
    for n in nodes:
        out.append(n); flatten(n["replies"], out)
    return out


def comment_count():
    s, b = call("GET", f"/v1/posts/{SLUG}")
    return b["data"]["commentCount"] if s == 200 else None


SECRET_BODY = f"연락처는 010-0000-0000 입니다 ({RUN})"

print("=== 등록 ===")
s, b = comment("공개작성자", "공개 댓글입니다")
check("공개 댓글 등록", s in (200, 201), f"{s} {b}")
open_id = b["data"]["id"]
check("공개 댓글은 isSecret=false", b["data"]["isSecret"] is False)
check("승인 없이 바로 공개된다", b["data"]["status"] == "approved", str(b["data"]))
check("응답에 화면이 그릴 값이 들어 있다",
      b["data"]["authorName"] == "공개작성자" and b["data"]["body"] == "공개 댓글입니다",
      str(b["data"]))

s, b = comment("비밀작성자", SECRET_BODY, secret=True)
check("비밀 댓글 등록", s in (200, 201), f"{s} {b}")
secret_id = b["data"]["id"]
check("비밀 댓글은 isSecret=true", b["data"]["isSecret"] is True)
check("비밀 댓글은 응답에서도 본문을 비운다",
      b["data"]["authorName"] == "" and b["data"]["body"] == "", str(b["data"]))
check("비밀 댓글 안내문이 다르다", "비밀" in (b["data"].get("message") or ""), str(b["data"]))

print("\n=== 공개 응답 마스킹 ===")
nodes = {n["id"]: n for n in flatten(tree())}
raw = json.dumps(nodes, ensure_ascii=False)
sec, opn = nodes.get(secret_id), nodes.get(open_id)
check("비밀 댓글이 목록에 존재한다", sec is not None)
check("비밀 댓글 body 가 비어 있다", sec and sec["body"] == "", repr(sec and sec["body"]))
check("비밀 댓글 authorName 이 비어 있다", sec and sec["authorName"] == "")
check("비밀 댓글 authorWebsite 가 null", sec and sec["authorWebsite"] is None)
check("비밀 댓글 isSecret 플래그는 내려간다", sec and sec["isSecret"] is True)
check("본문이 응답 어디에도 없다", SECRET_BODY not in raw)
check("작성자명이 응답 어디에도 없다", "비밀작성자" not in raw)
check("이메일 필드가 아예 없다", "authorEmail" not in raw)
check("공개 댓글은 그대로 보인다", opn and opn["body"] == "공개 댓글입니다")

print("\n=== 댓글 수 ===")
check("비밀 댓글도 댓글 수에 들어간다", comment_count() == 2, f"={comment_count()}")

print("\n=== 답글 전파 ===")
s, b = comment("눈치없는사람", "공개로 달아봅니다", secret=False, parent=secret_id)
check("비밀 댓글에 답글 등록", s in (200, 201), f"{s} {b}")
forced_id = b["data"]["id"]
check("isSecret=false 로 보내도 서버가 비밀로 만든다", b["data"]["isSecret"] is True, str(b["data"]))

s, b = call("POST", f"/v1/admin/comments/{open_id}/reply", {"body": "읽었습니다"})
check("관리자 답글 201", s == 201, f"{s} {b}")
owner_open = b["data"]["id"]
check("공개 댓글의 관리자 답글은 공개", b["data"]["isSecret"] is False)
check("관리자 답글도 바로 공개", b["data"]["status"] == "approved", str(b["data"]))

s, b = call("POST", f"/v1/admin/comments/{secret_id}/reply", {"body": "확인했습니다"})
check("비밀 댓글의 관리자 답글도 비밀", s == 201 and b["data"]["isSecret"] is True, f"{s} {b}")
owner_secret = b["data"]["id"]

print("\n=== 트리 구조 ===")
roots = tree()
nodes = {n["id"]: n for n in flatten(roots)}
raw = json.dumps(roots, ensure_ascii=False)
check("최상위는 공개 1 + 비밀 1", len(roots) == 2, f"={len(roots)}")
check("강제 비밀 답글이 비밀 댓글 아래에 붙는다",
      any(n["id"] == forced_id for n in nodes[secret_id]["replies"]))
check("관리자 비밀 답글도 비밀 댓글 아래에 붙는다",
      any(n["id"] == owner_secret for n in nodes[secret_id]["replies"]))
check("비밀 가지의 본문은 전부 비어 있다",
      nodes[forced_id]["body"] == "" and nodes[owner_secret]["body"] == "")
check("비밀 답글 본문이 응답에 없다", "확인했습니다" not in raw and "공개로 달아봅니다" not in raw)
check("관리자 공개 답글은 본문이 보인다", nodes[owner_open]["body"] == "읽었습니다")
check("관리자 답글에 isOwner 표시", nodes[owner_open]["isOwner"] is True)
check("관리자 답글에 이름이 붙는다", nodes[owner_open]["authorName"] not in ("", None),
      repr(nodes[owner_open]["authorName"]))
check("댓글 5건이 모두 집계된다", comment_count() == 5, f"={comment_count()}")

print("\n=== 제약 ===")
s, b = comment("깊이2", "여기까지는 된다", parent=owner_open)
check("depth 2 답글은 허용", s in (200, 201), f"{s} {b}")
deep_id = b["data"]["id"] if s in (200, 201) else None
if deep_id:
    s, b = comment("깊이3", "여기서는 막힌다", parent=deep_id)
    check("depth 3 답글은 422 로 거부", s == 422, f"{s} {b}")

s, b = comment("스팸작성자", "스팸으로 내릴 댓글")
spam_id = b["data"]["id"]
call("PATCH", f"/v1/admin/comments/{spam_id}", {"status": "spam"})
s, b = comment("성급한사람", "여기에 답글", parent=spam_id)
check("스팸 처리된 댓글에는 답글을 못 단다", s == 400, f"{s} {b}")

s, b = comment("엉뚱한사람", "없는 댓글에 답글", parent=999999)
check("없는 댓글에 답글은 400", s == 400, f"{s} {b}")

print("\n=== 카운터 ===")
before = comment_count()
call("PATCH", f"/v1/admin/comments/{secret_id}", {"status": "spam"})
check("비밀 댓글을 스팸 처리하면 댓글 수가 하나 준다", comment_count() == before - 1,
      f"{before} -> {comment_count()}")
call("PATCH", f"/v1/admin/comments/{secret_id}", {"status": "approved"})
check("되돌리면 댓글 수도 돌아온다", comment_count() == before,
      f"{before} -> {comment_count()}")

print("\n=== 관리자 화면은 원문을 본다 ===")
s, b = call("GET", "/v1/admin/comments?status=approved")
rows = {c["id"]: c for c in (b["data"] if s == 200 else [])}
check("관리자 큐에 비밀 댓글 본문이 보인다", rows.get(secret_id, {}).get("body") == SECRET_BODY,
      str(rows.get(secret_id)))
check("관리자 큐에 비밀 작성자명이 보인다", rows.get(secret_id, {}).get("authorName") == "비밀작성자")
check("관리자 큐에 isSecret 이 내려온다", rows.get(secret_id, {}).get("isSecret") is True)
check("관리자 큐에 isOwner 가 내려온다", rows.get(owner_open, {}).get("isOwner") is True)

print(f"\n통과 {passed} / 실패 {failed}")
sys.exit(1 if failed else 0)
