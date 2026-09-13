import { useSession } from '../state/SessionContext.jsx';
import { useMe } from '../api/hooks.js';
import { ErrorNote, Loading } from '../components/Status.jsx';
import StudentDashboard from './student/StudentDashboard.jsx';
import InstructorDashboard from './instructor/InstructorDashboard.jsx';

// Role switch. The questionnaire choice decides which dashboard renders.
export default function Dashboard() {
  const { session } = useSession();
  const me = useMe();
  if (me.isLoading) return <Loading label="Loading your dashboard..." />;
  if (me.error) return <ErrorNote error={me.error} retry={me.refetch} />;
  return session.user.role === 'instructor' ? <InstructorDashboard me={me.data} /> : <StudentDashboard me={me.data} />;
}
