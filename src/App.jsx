import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './state/SessionContext.jsx';
import Landing from './pages/Landing.jsx';
import InstitutionAuth from './pages/InstitutionAuth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ClassView from './pages/ClassView.jsx';
import ChatView from './pages/student/ChatView.jsx';
import Shell from './components/Shell.jsx';

function RequireAuth({ children }) {
  const { session } = useSession();
  const location = useLocation();
  if (!session) return <Navigate to="/" replace state={{ from: location }} />;
  return children;
}

export default function App() {
  const { session } = useSession();
  return (
    <Routes>
      {/* Returning users skip the questionnaire */}
      <Route path="/" element={session ? <Navigate to="/dashboard" replace /> : <Landing />} />
      <Route path="/auth" element={<InstitutionAuth />} />
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        {/* Both render a student or instructor variant based on session.role */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/class/:classId" element={<ClassView />} />
        <Route path="/class/:classId/chat/:chatId" element={<ChatView />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
