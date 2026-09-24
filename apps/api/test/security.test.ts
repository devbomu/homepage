import { describe, expect, it } from 'vitest';

import type { AdminIdentity, Bindings } from '../src/env';
import { isAllowedAdmin } from '../src/lib/access';
import { hashPassword, issueUnlockToken, verifyUnlockToken } from '../src/lib/password';
import { visitorUrl } from '../src/lib/url';

/**
 * 보안 회귀 테스트.
 *
 * 여기 있는 것들은 "고쳤는데 조용히 되돌아가면 알아채지 못하는" 종류다.
 * 기능이 깨지는 게 아니라 방어가 없어지는 쪽이라 화면으로는 보이지 않는다.
 */

const SALT = 'a'.repeat(48);

function env(overrides: Partial<Bindings> = {}): Bindings {
  return { ENVIRONMENT: 'production', ADMIN_EMAILS: 'owner@example.com', ...overrides } as Bindings;
}

function identity(over: Partial<AdminIdentity> = {}): AdminIdentity {
  return { email: '', commonName: '', subject: 'sub', ...over };
}

describe('isAllowedAdmin', () => {
  it('허용 목록에 있는 이메일은 통과시킨다', () => {
    expect(isAllowedAdmin(env(), identity({ email: 'owner@example.com' }))).toBe(true);
  });

  it('대소문자가 달라도 같은 이메일로 본다', () => {
    expect(isAllowedAdmin(env(), identity({ email: 'Owner@Example.com'.toLowerCase() }))).toBe(
      true,
    );
  });

  it('허용 목록에 없는 이메일은 막는다', () => {
    expect(isAllowedAdmin(env(), identity({ email: 'stranger@example.com' }))).toBe(false);
  });

  it('서비스 토큰(common_name 만 있는 신원)은 허용 목록을 건너뛰지 못한다', () => {
    // 예전에는 여기서 true 가 나왔다. Access 정책이 넓게 열렸을 때를
    // 대비하는 함수가, 정작 그 상황에서만 뚫리는 구멍을 갖고 있었다.
    expect(isAllowedAdmin(env(), identity({ commonName: 'ci-bot' }))).toBe(false);
  });

  it('운영에서 허용 목록이 비어 있으면 아무도 통과시키지 않는다', () => {
    expect(isAllowedAdmin(env({ ADMIN_EMAILS: '' }), identity({ email: 'a@b.com' }))).toBe(false);
  });
});

describe('해제 토큰', () => {
  it('발급한 토큰은 같은 글에서 통한다', async () => {
    const hash = await hashPassword('열려라');
    const { token, expiresAt } = await issueUnlockToken(SALT, 7, hash);
    expect(await verifyUnlockToken(SALT, 7, hash, token)).toBe(expiresAt);
  });

  it('다른 글의 토큰은 통하지 않는다', async () => {
    const hash = await hashPassword('열려라');
    const { token } = await issueUnlockToken(SALT, 7, hash);
    expect(await verifyUnlockToken(SALT, 8, hash, token)).toBeNull();
  });

  it('비밀번호를 바꾸면 기존 토큰이 죽는다', async () => {
    // 같은 평문이라도 솔트가 달라 해시가 바뀐다. 즉 "비밀번호 재설정" 과 같다.
    const before = await hashPassword('열려라');
    const after = await hashPassword('열려라');
    expect(before).not.toBe(after);

    const { token } = await issueUnlockToken(SALT, 7, before);
    expect(await verifyUnlockToken(SALT, 7, after, token)).toBeNull();
  });

  it('서명을 손댄 토큰은 통하지 않는다', async () => {
    const hash = await hashPassword('열려라');
    const { token } = await issueUnlockToken(SALT, 7, hash);
    const [id, exp] = token.split('.');
    expect(await verifyUnlockToken(SALT, 7, hash, `${id}.${exp}.forged`)).toBeNull();
  });

  it('만료 시각을 늘려 적은 토큰은 통하지 않는다', async () => {
    const hash = await hashPassword('열려라');
    const { token } = await issueUnlockToken(SALT, 7, hash);
    const [id, , sig] = token.split('.');
    const far = Math.floor(Date.now() / 1000) + 99_999_999;
    expect(await verifyUnlockToken(SALT, 7, hash, `${id}.${far}.${sig}`)).toBeNull();
  });

  it('이미 만료된 토큰은 통하지 않는다', async () => {
    const hash = await hashPassword('열려라');
    const past = Math.floor(Date.now() / 1000) - 10;
    // 만료된 토큰을 정상 서명으로 만들어 낸다 (서명이 아니라 시각으로 걸려야 한다).
    const { token } = await issueUnlockToken(SALT, 7, hash);
    const forged = `7.${past}.${token.split('.')[2]}`;
    expect(await verifyUnlockToken(SALT, 7, hash, forged)).toBeNull();
  });
});

describe('visitorUrl', () => {
  /*
   * z.url() 은 new URL() 로 파싱만 해서 javascript: 를 "올바른 주소" 로 통과시킨다.
   * 이 값이 공개 화면의 <a href> 로 들어가므로, 인증 없는 방문자가 남긴 문자열이
   * 다른 방문자의 브라우저에서 실행될 수 있었다.
   */
  it('http/https 만 받는다', () => {
    expect(visitorUrl.safeParse('https://example.com').success).toBe(true);
    expect(visitorUrl.safeParse('http://example.com/a?b=1').success).toBe(true);
  });

  it('실행 가능한 스킴을 거부한다', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ]) {
      expect(visitorUrl.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('mailto/tel 도 홈페이지 칸에는 받지 않는다', () => {
    expect(visitorUrl.safeParse('mailto:a@b.com').success).toBe(false);
    expect(visitorUrl.safeParse('tel:+8210').success).toBe(false);
  });

  it('주소가 아닌 값도 거부한다', () => {
    expect(visitorUrl.safeParse('example.com').success).toBe(false);
    expect(visitorUrl.safeParse('//evil.com').success).toBe(false);
  });
});
