import { Route, Routes } from 'react-router';

import Layout from './components/Layout';
import Comments from './pages/Comments';
import Guestbook from './pages/Guestbook';
import Dashboard from './pages/Dashboard';
import Media from './pages/Media';
import NotFound from './pages/NotFound';
import PostEditor from './pages/PostEditor';
import Posts from './pages/Posts';
import Projects from './pages/Projects';
import Settings from './pages/Settings';
import SitePages from './pages/SitePages';
import Taxonomy from './pages/Taxonomy';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="posts" element={<Posts />} />
        <Route path="posts/new" element={<PostEditor />} />
        <Route path="posts/:id" element={<PostEditor />} />
        <Route path="taxonomy" element={<Taxonomy />} />
        <Route path="comments" element={<Comments />} />
        <Route path="guestbook" element={<Guestbook />} />
        <Route path="media" element={<Media />} />
        <Route path="pages" element={<SitePages />} />
        <Route path="projects" element={<Projects />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
