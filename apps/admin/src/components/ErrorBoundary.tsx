import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 한 화면에서 난 렌더 오류가 앱 전체를 흰 화면으로 만들지 않게 막는다.
 *
 * 설정 화면이 Children.only 위반으로 통째로 죽은 적이 있는데,
 * 타입 검사도 빌드도 잡지 못하고 런타임에야 드러났다.
 * 그때 사용자가 본 것은 아무 설명 없는 흰 화면이었다.
 * 최소한 무엇이 잘못됐는지는 보여야 한다.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('화면 렌더 중 오류', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex flex-col items-start gap-4 py-16">
        <div>
          <h1 className="text-xl font-bold">화면을 그리지 못했습니다</h1>
          <p className="text-base-content/60 mt-1 text-sm">
            이 화면에서만 생긴 문제입니다. 다른 메뉴는 정상 동작합니다.
          </p>
        </div>

        <pre className="bg-base-100 max-w-full overflow-x-auto rounded-lg p-4 text-xs">
          {error.message}
        </pre>

        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm" onClick={() => this.setState({ error: null })}>
            다시 시도
          </button>
          <a href="/" className="btn btn-ghost btn-sm">
            대시보드로
          </a>
        </div>
      </div>
    );
  }
}
