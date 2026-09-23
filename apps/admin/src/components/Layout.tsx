import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation } from 'react-router';

import { adminApi } from '../lib/api';
import ErrorBoundary from './ErrorBoundary';

const NAV = [
  { to: '/', label: '대시보드', end: true },
  { to: '/posts', label: '글' },
  { to: '/taxonomy', label: '분류' },
  { to: '/comments', label: '댓글' },
  { to: '/media', label: '미디어' },
  { to: '/pages', label: '페이지' },
  { to: '/projects', label: '프로젝트' },
  { to: '/settings', label: '설정' },
];

export default function Layout() {
  const location = useLocation();
  const me = useQuery({ queryKey: ['me'], queryFn: () => adminApi.me().then((r) => r.data) });

  return (
    <div className="drawer lg:drawer-open">
      <input id="admin-drawer" type="checkbox" className="drawer-toggle" />

      <div className="drawer-content flex min-h-screen flex-col">
        <header className="navbar bg-base-100 border-base-300 sticky top-0 z-30 border-b lg:hidden">
          <label
            htmlFor="admin-drawer"
            className="btn btn-ghost btn-sm drawer-button"
            aria-label="메뉴 열기"
          >
            ☰
          </label>
          <span className="ml-2 font-bold">관리자</span>
        </header>

        <main className="flex-1 p-4 sm:p-6">
          {/* key 를 경로로 두어 다른 메뉴로 이동하면 오류 상태가 자동으로 풀린다. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <div className="drawer-side z-40">
        <label htmlFor="admin-drawer" className="drawer-overlay" aria-label="메뉴 닫기"></label>

        <nav className="bg-base-100 border-base-300 flex min-h-full w-60 flex-col border-r">
          <div className="border-base-300 border-b px-4 py-4">
            <p className="font-bold">namsu.kim</p>
            <p className="text-base-content/50 text-xs">관리자</p>
          </div>

          <ul className="menu flex-1 gap-1 p-3">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  <span className="flex-1">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="border-base-300 border-t p-3 text-xs">
            <p className="text-base-content/60 truncate" title={me.data?.email}>
              {me.data?.email ?? me.data?.commonName ?? '…'}
            </p>
            <a
              href="https://www.namsu.kim"
              target="_blank"
              rel="noreferrer"
              className="link link-hover mt-1 inline-block"
            >
              사이트 보기 ↗
            </a>
          </div>
        </nav>
      </div>
    </div>
  );
}
