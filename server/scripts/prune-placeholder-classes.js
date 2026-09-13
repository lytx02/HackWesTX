// Removes placeholder classes: rows with no canvas_course_id, i.e. the seeded
// demo classes and anything made with the Add class form. Enrollments,
// assignments, submissions, conversations, digests and summaries in those
// classes cascade away with them. Canvas-imported classes are never touched.
//
//   node --env-file-if-exists=.env scripts/prune-placeholder-classes.js                 # dry run: list only
//   node --env-file-if-exists=.env scripts/prune-placeholder-classes.js --yes           # delete
//   node --env-file-if-exists=.env scripts/prune-placeholder-classes.js --seeded-only   # only the src/data/mock.js demo classes
//   node --env-file-if-exists=.env scripts/prune-placeholder-classes.js --keep "CS 4283 / 5383" --keep "MATH 3013"
//
// Nothing is deleted without --yes. New users stop receiving these classes once
// AUTO_ENROLL_PLACEHOLDERS is unset (the default), so they do not come back.

import { inArray, isNull, sql } from 'drizzle-orm';
import { db, pool } from '../src/db.js';
import { classes } from '../src/schema.js';
import * as mock from '../../src/data/mock.js';

function parseArgs(argv) {
  const options = { yes: false, seededOnly: false, keep: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--seeded-only') options.seededOnly = true;
    else if (arg === '--keep') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--keep requires a course code');
      options.keep.push(value.trim().toLowerCase());
      i += 1;
    } else throw new Error(`Unknown argument "${arg}"`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const seededKey = (c) => `${c.code}\u0000${c.name}`.toLowerCase();
const seeded = new Set(mock.classes.map(seededKey));

const rows = await db
  .select({
    id: classes.id,
    code: classes.code,
    name: classes.name,
    institutionId: classes.institutionId,
    // Qualified by hand: in a single-table FROM, ${classes.id} would render as a bare "id" (see routes/me.js).
    members: sql`(select count(*) from enrollments e where e.class_id = classes.id)::int`,
    assignments: sql`(select count(*) from assignments a where a.class_id = classes.id)::int`,
  })
  .from(classes)
  .where(isNull(classes.canvasCourseId))
  .orderBy(classes.createdAt);

const targets = rows
  .map((r) => ({ ...r, seeded: seeded.has(seededKey(r)) }))
  .filter((r) => !options.keep.includes(r.code.trim().toLowerCase()))
  .filter((r) => !options.seededOnly || r.seeded);

if (targets.length === 0) {
  console.log('No placeholder classes match.');
} else {
  console.table(
    targets.map((r) => ({
      code: r.code,
      name: r.name,
      institution: r.institutionId ?? '-',
      seeded: r.seeded ? 'yes' : 'no',
      members: r.members,
      assignments: r.assignments,
    }))
  );
  if (options.yes) {
    await db.delete(classes).where(inArray(classes.id, targets.map((r) => r.id)));
    console.log(`Deleted ${targets.length} class(es).`);
  } else {
    console.log(`Dry run: ${targets.length} class(es) would be deleted. Re-run with --yes to delete them.`);
  }
}
await pool.end();
