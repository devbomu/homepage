import { describe, expect, it } from 'vitest';

import { newCommentMail, replyMail, sendMail } from '../src/lib/email';
import type { Bindings } from '../src/env';

const base = {
  to: 'visitor@example.com',
  postTitle: '첫 글',
  postUrl: 'https://www.namsu.kim/blog/first#comments',
};

describe('replyMail', () => {
  it('원문과 답글을 모두 담는다', () => {
    const mail = replyMail({
      ...base,
      originalBody: '질문이 있습니다',
      replyAuthor: '남수',
      replyBody: '답변입니다',
      isSecret: false,
    });
    expect(mail.to).toBe('visitor@example.com');
    expect(mail.text).toContain('질문이 있습니다');
    expect(mail.text).toContain('답변입니다');
    expect(mail.html).toContain('남수');
    expect(mail.subject).toContain('첫 글');
  });

  it('비밀 댓글이면 제목과 안내가 달라진다', () => {
    const secret = replyMail({
      ...base,
      originalBody: 'q',
      replyAuthor: '남수',
      replyBody: 'a',
      isSecret: true,
    });
    expect(secret.subject).toContain('비밀');
    // 비밀 댓글의 답은 사이트에서 볼 수 없으므로 그 사실을 알려야 한다.
    expect(secret.text).toContain('이 메일로만');
    expect(secret.html).toContain('이 메일로만');
  });

  it('본문의 HTML 을 이스케이프한다', () => {
    const mail = replyMail({
      ...base,
      originalBody: '<img src=x onerror=alert(1)>',
      replyAuthor: '<b>주인</b>',
      replyBody: '"따옴표" & <script>',
      isSecret: false,
    });
    expect(mail.html).not.toContain('<img');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<b>주인</b>');
    expect(mail.html).toContain('&lt;img');
    expect(mail.html).toContain('&amp;');
  });

  it('아주 긴 본문은 잘라 넣는다', () => {
    const mail = replyMail({
      ...base,
      originalBody: 'ㄱ'.repeat(5000),
      replyAuthor: '남수',
      replyBody: 'ok',
      isSecret: false,
    });
    expect(mail.html).toContain('…');
    expect(mail.html.length).toBeLessThan(3000);
  });
});

describe('newCommentMail', () => {
  it('댓글과 답글을 구분해 제목을 만든다', () => {
    const comment = newCommentMail({
      ...base,
      adminUrl: 'https://admin.namsu.kim/comments',
      authorName: '방문자',
      body: '안녕하세요',
      isSecret: false,
      isReply: false,
    });
    expect(comment.subject).toContain('새 댓글');

    const reply = newCommentMail({
      ...base,
      adminUrl: 'https://admin.namsu.kim/comments',
      authorName: '방문자',
      body: '안녕하세요',
      isSecret: true,
      isReply: true,
    });
    expect(reply.subject).toContain('비밀 답글');
  });

  it('작성자 이름의 HTML 도 이스케이프한다', () => {
    const mail = newCommentMail({
      ...base,
      adminUrl: 'https://admin.namsu.kim/comments',
      authorName: '<script>alert(1)</script>',
      body: 'x',
      isSecret: false,
      isReply: false,
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('sendMail', () => {
  const mail = { to: 'a@example.com', subject: 's', text: 't', html: '<p>t</p>' };

  it('설정이 비어 있으면 아무것도 보내지 않는다', async () => {
    // 로컬 개발과 아직 도메인 인증을 안 한 운영에서 댓글이 막히면 안 된다.
    const env = { RESEND_API_KEY: '', MAIL_FROM: '' } as unknown as Bindings;
    expect(await sendMail(env, mail)).toBe(false);
  });

  it('키만 있고 발신자가 없으면 보내지 않는다', async () => {
    const env = { RESEND_API_KEY: 'k', MAIL_FROM: '' } as unknown as Bindings;
    expect(await sendMail(env, mail)).toBe(false);
  });
});
