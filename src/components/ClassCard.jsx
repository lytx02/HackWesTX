import { useNavigate } from 'react-router-dom';

// Box element for the class showcase grids.
export function ClassCard({ cls, subtitle }) {
  const navigate = useNavigate();
  return (
    <button type="button" className="box class-box" onClick={() => navigate(`/class/${cls.id}`)} style={{ '--box-accent': cls.color }}>
      <span className="eyebrow">{cls.code}</span>
      <h3>{cls.name}</h3>
      <span className="muted">{subtitle ?? cls.instructor}</span>
    </button>
  );
}

export function AddBox({ label, onClick }) {
  return (
    <button type="button" className="box add-box" onClick={onClick}>
      <span className="plus">+</span>
      <span className="muted">{label}</span>
    </button>
  );
}
