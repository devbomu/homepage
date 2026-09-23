/**
 * Turnstile 스크립트는 외부에서 로드되어 window 에 자신을 붙인다.
 * 타입 정의가 따로 없으므로 우리가 실제로 쓰는 부분만 선언한다.
 *
 * optional 로 둔 이유: 사이트 키가 비어 있으면 스크립트 자체를 넣지 않는다.
 * 그 경우 window.turnstile 은 undefined 이고, 호출부도 옵셔널 체이닝을 쓴다.
 */
declare global {
  interface Window {
    turnstile?: {
      reset(widgetId?: string): void;
      getResponse(widgetId?: string): string | undefined;
    };
  }
}

export {};
