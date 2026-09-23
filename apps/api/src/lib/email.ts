/**
 * 메일 발송.
 *
 * Cloudflare 의 Email Routing 은 받기만 하고, Email Workers 의 send_email 바인딩은
 * 계정에 등록·검증된 주소로만 보낼 수 있다. 댓글 작성자는 임의의 주소이므로
 * 외부 발송 서비스가 필요하다. Resend 는 HTTP 한 방이라 Workers 에서
 * 변환 계층 없이 그대로 쓴다.
 *
 * 설정이 비어 있으면 조용히 건너뛴다. 로컬 개발과, 아직 도메인 인증을 하지 않은
 * 운영에서 댓글 기능 자체가 막히면 안 되기 때문이다.
 */

import type { Bindings } from '../env';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendMail(env: Bindings, mail: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return false;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });

    if (!response.ok) {
      // 수신자 주소는 로그에 남기지 않는다.
      console.error('mail: 발송 실패', response.status, await response.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (error) {
    console.error('mail: 발송 중 오류', error);
    return false;
  }
}

/** 본문에 <, &, " 같은 것이 그대로 들어가면 메일 HTML 이 깨진다. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 본문이 길면 메일에서는 잘라 보여준다. 전문은 링크로 본다. */
function clip(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function layout(heading: string, blocks: string[], link: string, footer: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;line-height:1.7;color:#394e6a;max-width:560px">
  <h2 style="font-size:17px;margin:0 0 16px">${escapeHtml(heading)}</h2>
  ${blocks.join('\n  ')}
  <p style="margin:24px 0 0"><a href="${escapeHtml(link)}" style="color:#0069ff">글에서 보기 →</a></p>
  <p style="margin:24px 0 0;font-size:12px;color:#9aa8bd">${escapeHtml(footer)}</p>
</div>`;
}

function quote(label: string, author: string, body: string): string {
  return `<p style="margin:0 0 6px;font-size:13px;color:#9aa8bd">${escapeHtml(label)} · ${escapeHtml(author)}</p>
  <blockquote style="margin:0 0 20px;padding:10px 14px;border-left:3px solid #e3e9f4;background:#f2f7fe;white-space:pre-wrap">${escapeHtml(clip(body))}</blockquote>`;
}

export interface ReplyMailInput {
  to: string;
  postTitle: string;
  postUrl: string;
  originalBody: string;
  replyAuthor: string;
  replyBody: string;
  isSecret: boolean;
}

/**
 * 내 댓글에 답글이 달렸다는 알림.
 *
 * 비밀 댓글이면 이 메일이 답을 읽는 유일한 통로다 — 로그인이 없어서
 * 공개 화면에서는 본인 확인을 할 수 없고, 화면에는 잠금 표시만 나간다.
 */
export function replyMail(input: ReplyMailInput): Mail {
  const subject = `[${input.postTitle}] 남기신 ${input.isSecret ? '비밀 ' : ''}댓글에 답글이 달렸습니다`;

  const text = [
    `남기신 댓글에 답글이 달렸습니다.`,
    ``,
    `내 댓글: ${clip(input.originalBody)}`,
    ``,
    `${input.replyAuthor}: ${clip(input.replyBody)}`,
    ``,
    input.isSecret
      ? `비밀 댓글이라 사이트에서는 내용이 보이지 않습니다. 이 메일로만 확인하실 수 있습니다.`
      : `글에서 보기: ${input.postUrl}`,
  ].join('\n');

  return {
    to: input.to,
    subject,
    text,
    html: layout(
      '남기신 댓글에 답글이 달렸습니다',
      [
        quote('내 댓글', '나', input.originalBody),
        quote('답글', input.replyAuthor, input.replyBody),
      ],
      input.postUrl,
      input.isSecret
        ? '비밀 댓글이라 사이트에서는 내용이 보이지 않습니다. 답글은 이 메일로만 확인하실 수 있습니다.'
        : '이 메일은 남기신 댓글에 답글이 달려 한 번 발송되었습니다.',
    ),
  };
}

export interface NewCommentMailInput {
  to: string;
  postTitle: string;
  postUrl: string;
  adminUrl: string;
  authorName: string;
  body: string;
  isSecret: boolean;
  isReply: boolean;
}

/** 새 댓글이 달렸다는 주인용 알림. */
export function newCommentMail(input: NewCommentMailInput): Mail {
  const kind = `${input.isSecret ? '비밀 ' : ''}${input.isReply ? '답글' : '댓글'}`;
  const subject = `[${input.postTitle}] 새 ${kind}: ${input.authorName}`;

  const text = [
    `${input.postTitle} 에 새 ${kind}이 달렸습니다.`,
    ``,
    `${input.authorName}: ${clip(input.body)}`,
    ``,
    `글에서 보기: ${input.postUrl}`,
    `관리자에서 보기: ${input.adminUrl}`,
  ].join('\n');

  return {
    to: input.to,
    subject,
    text,
    html: layout(
      `새 ${kind}이 달렸습니다`,
      [quote(input.postTitle, input.authorName, input.body)],
      input.postUrl,
      '댓글 관리는 관리자 화면에서 할 수 있습니다.',
    ),
  };
}
