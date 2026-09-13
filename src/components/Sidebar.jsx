import { useState } from 'react';
import { NavLink } from 'react-router-dom';

// Sidebar mode is remembered per browser. Versioned key: bump when the shape changes.
const STORAGE_KEY = 'campus-ai.sidebar:v1';
const MODES = ['collapsed', 'expanded'];

function loadMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(stored) ? stored : 'collapsed';
  } catch {
    return 'collapsed'; // storage disabled or private browsing
  }
}

function persistMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
}

// 'collapsed' = icon rail, 'expanded' = course blocks. The choice survives reloads.
export function useSidebarMode() {
  const [mode, setMode] = useState(loadMode);
  const toggle = () => {
    const next = mode === 'expanded' ? 'collapsed' : 'expanded';
    persistMode(next);
    setMode(next);
  };
  return { mode, toggle };
}

// Sits on the sidebar's top-right edge. Lives in the persistent frame so it keeps
// keyboard focus while the rail/panel content underneath it is swapped.
export function SidebarToggle({ mode, onToggle }) {
  const expanded = mode === 'expanded';
  const label = expanded ? 'Collapse sidebar' : 'Expand sidebar';
  return (
    <button
      type="button"
      className="sidebar-toggle"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls="sidebar-nav"
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{expanded ? '‹' : '›'}</span>
    </button>
  );
}

const iconClass = ({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`;
const rowClass = ({ isActive }) => `nav-row ${isActive ? 'active' : ''}`;
const blockClass = ({ isActive }) => `course-block ${isActive ? 'active' : ''}`;

// Collapsed variant: one icon per destination, each course as its color swatch.
export function IconRail({ classes, themeName, onCycleTheme, onSignOut }) {
  return (
    <>
      <div className="brand" title="Campus AI">
        C
      </div>
      <nav id="sidebar-nav" className="sidebar-nav" aria-label="Main">
        <NavLink to="/dashboard" className={iconClass} title="Home">
          ⌂
        </NavLink>
        {classes.map((c) => (
          <NavLink key={c.id} to={`/class/${c.id}`} className={iconClass} title={c.name}>
            <span className="swatch" style={{ background: c.color, margin: 0 }} />
          </NavLink>
        ))}
      </nav>
      <button type="button" className="nav-btn" onClick={onCycleTheme} title={`Theme: ${themeName}`}>
        ◐
      </button>
      <button type="button" className="nav-btn" onClick={onSignOut} title="Sign out">
        ⏻
      </button>
    </>
  );
}

// Expanded variant: labelled rows plus one block per course
// (color sliver on top, then the course name, then the course number in smaller type).
export function CoursePanel({ classes, themeName, onCycleTheme, onSignOut }) {
  return (
    <>
      <div className="brand brand-wordmark" title="Chalk">
        <span className="brand-mark">C</span>
        <span className="brand-name">Chalk</span>
      </div>
      <nav id="sidebar-nav" className="sidebar-nav" aria-label="Main">
        <NavLink to="/dashboard" className={rowClass}>
          <span className="nav-icon" aria-hidden="true">
            ⌂
          </span>
          Home
        </NavLink>
        <p className="eyebrow sidebar-heading">Courses</p>
        {classes.length === 0 && <p className="muted sidebar-empty">No courses yet</p>}
        {classes.map((c) => (
          <CourseBlock key={c.id} cls={c} />
        ))}
      </nav>
      <button type="button" className="nav-row" onClick={onCycleTheme} title={`Theme: ${themeName}`}>
        <span className="nav-icon" aria-hidden="true">
          ◐
        </span>
        Theme: {themeName}
      </button>
      <button type="button" className="nav-row" onClick={onSignOut}>
        <span className="nav-icon" aria-hidden="true">
          ⏻
        </span>
        Sign out
      </button>
    </>
  );
}

function CourseBlock({ cls }) {
  return (
    <NavLink to={`/class/${cls.id}`} className={blockClass} style={{ '--block-accent': cls.color }} title={cls.name}>
      <span className="course-block-name">{cls.name}</span>
      <span className="course-block-code">{cls.code}</span>
    </NavLink>
  );
}
