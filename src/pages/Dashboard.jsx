import { useSession } from '../state/SessionContext.jsx';
import StudentDashboard from './student/StudentDashboard.jsx';
import InstructorDashboard from './instructor/InstructorDashboard.jsx';

// Role switch. The questionnaire choice decides which dashboard renders.
export default function Dashboard() {
  const { session } = useSession();
  return session.role === 'instructor' ? <InstructorDashboard /> : <StudentDashboard />;
}
