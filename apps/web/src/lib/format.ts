/** 날짜·숫자 표기. 사이트 전체가 한국어라 ko-KR 기준으로 맞춘다. */

const KST = 'Asia/Seoul';

/** unix epoch 초 -> Date. API 는 전부 초 단위로 내려준다. */
export function toDate(seconds: number | null | undefined): Date | null {
  return seconds == null ? null : new Date(seconds * 1000);
}

export function formatDate(seconds: number | null | undefined): string {
  const date = toDate(seconds);
  if (!date) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: KST,
  }).format(date);
}

/** datetime 속성용 ISO 문자열. */
export function toIso(seconds: number | null | undefined): string {
  return toDate(seconds)?.toISOString() ?? '';
}

/** "3일 전" 같은 상대 표기. 한 달이 넘으면 절대 날짜가 더 읽기 좋다. */
export function formatRelative(seconds: number | null | undefined): string {
  const date = toDate(seconds);
  if (!date) return '';

  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return '방금';

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
  ];

  const formatter = new Intl.RelativeTimeFormat('ko-KR', { numeric: 'auto' });
  for (const [unit, size] of units.reverse()) {
    if (diffSeconds >= size) {
      return formatter.format(-Math.floor(diffSeconds / size), unit);
    }
  }
  return formatDate(seconds);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(value);
}

/** 'dev/backend/go' -> '/category/dev/backend/go' */
export function categoryUrl(path: string): string {
  return `/category/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function postUrl(slug: string): string {
  return `/blog/${encodeURIComponent(slug)}`;
}

export function tagUrl(slug: string): string {
  return `/tag/${encodeURIComponent(slug)}`;
}
