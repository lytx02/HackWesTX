import { Navigate, useParams } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';
import { useData } from '../state/DataContext.jsx';
import StudentClassView from './student/StudentClassView.jsx';
import InstructorClassView from './instructor/InstructorClassView.jsx';

// Role switch for /class/:classId.
export default function ClassView() {
  const { session } = useSession();
  const { classId } = useParams();
  const { classById } = useData();
  const cls = classById(classId);
  if (!cls) return <Navigate to="/dashboard" replace />;
  return session.role === 'instructor' ? <InstructorClassView cls={cls} /> : <StudentClassView cls={cls} />;
}
