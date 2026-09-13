import { Navigate, useParams } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';
import { useClass } from '../api/hooks.js';
import { ErrorNote, Loading } from '../components/Status.jsx';
import StudentClassView from './student/StudentClassView.jsx';
import InstructorClassView from './instructor/InstructorClassView.jsx';

// Role switch for /class/:classId. Fetches the class payload once and hands it down.
export default function ClassView() {
  const { session } = useSession();
  const { classId } = useParams();
  const q = useClass(classId);

  if (q.isLoading) return <Loading label="Loading class..." />;
  if (q.error?.status === 404 || q.error?.status === 403) return <Navigate to="/dashboard" replace />;
  if (q.error) return <ErrorNote error={q.error} retry={q.refetch} />;

  const data = q.data;
  return session.user.role === 'instructor' && data.membership === 'instructor' ? (
    <InstructorClassView data={data} />
  ) : (
    <StudentClassView data={data} />
  );
}
