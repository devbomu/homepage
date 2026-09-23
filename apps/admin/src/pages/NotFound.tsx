import { Link } from 'react-router';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-4xl font-bold">404</p>
      <p className="text-base-content/60 text-sm">없는 화면입니다.</p>
      <Link to="/" className="btn btn-primary btn-sm">
        대시보드로
      </Link>
    </div>
  );
}
