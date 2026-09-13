// Week helpers: Monday-start weeks. Returns assignments for the current week,
// or for next week if the current week has none. Assignments use `dueDate`
// (YYYY-MM-DD) as returned by the API.

const DAY = 86_400_000;

export function startOfWeek(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const shift = (x.getDay() + 6) % 7; // Mon=0 ... Sun=6
  x.setDate(x.getDate() - shift);
  return x;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function weekOf(assignments, weekStart) {
  const end = new Date(weekStart.getTime() + 7 * DAY);
  return assignments
    .filter((a) => {
      const due = parseISO(a.dueDate);
      return due >= weekStart && due < end;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function upcomingWeek(assignments, today = new Date()) {
  const thisWeek = startOfWeek(today);
  let items = weekOf(assignments, thisWeek).filter((a) => !a.done);
  if (items.length) return { label: 'This week', weekStart: thisWeek, items };
  const nextWeek = new Date(thisWeek.getTime() + 7 * DAY);
  items = weekOf(assignments, nextWeek).filter((a) => !a.done);
  return { label: 'Next week', weekStart: nextWeek, items };
}

export function fmtDate(iso) {
  // Pinned to en-US for the POC so dates read the same on every machine.
  return parseISO(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
