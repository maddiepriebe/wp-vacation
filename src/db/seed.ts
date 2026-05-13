import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  admins,
  classes,
  employees,
  holidays,
  settings,
  type NewAdmin,
  type NewClass,
  type NewEmployee,
  type NewHoliday,
} from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to run the seed");
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const db = drizzle(sql);

// =========================================================================
// Classes — canonical list per docs/CLAUDE.md.
// 1 infant + 3 toddler + 4 preschool + 1 floater = 9 total.
// Ratios per PRD §5.6. Floater pool has no ratio / max group.
// =========================================================================
const classSeed: NewClass[] = [
  {
    name: "Infants",
    ageGroup: "infant",
    ratioTeacherToStudents: 3,
    maxGroupSize: 7,
    isFloaterPool: false,
  },
  {
    name: "Ducks",
    ageGroup: "toddler",
    ratioTeacherToStudents: 4,
    maxGroupSize: 9,
    isFloaterPool: false,
  },
  {
    name: "Bumblebees",
    ageGroup: "toddler",
    ratioTeacherToStudents: 4,
    maxGroupSize: 9,
    isFloaterPool: false,
  },
  {
    name: "Turtles",
    ageGroup: "toddler",
    ratioTeacherToStudents: 4,
    maxGroupSize: 9,
    isFloaterPool: false,
  },
  {
    name: "Panthers",
    ageGroup: "preschool",
    ratioTeacherToStudents: 10,
    maxGroupSize: 20,
    isFloaterPool: false,
  },
  {
    name: "Penguins",
    ageGroup: "preschool",
    ratioTeacherToStudents: 10,
    maxGroupSize: 20,
    isFloaterPool: false,
  },
  {
    name: "Pre-K",
    ageGroup: "preschool",
    ratioTeacherToStudents: 10,
    maxGroupSize: 20,
    isFloaterPool: false,
  },
  {
    name: "Kindergarten",
    ageGroup: "preschool",
    ratioTeacherToStudents: 10,
    maxGroupSize: 20,
    isFloaterPool: false,
  },
  {
    name: "Floater Pool",
    ageGroup: "floater_pool",
    ratioTeacherToStudents: null,
    maxGroupSize: null,
    isFloaterPool: true,
  },
];

const adminSeed: NewAdmin[] = [
  {
    firstName: "Maddie",
    lastName: "Owner",
    email: "maddie.priebe@gmail.com",
    adminRole: "owner",
  },
  {
    firstName: "Sample",
    lastName: "HR",
    email: "hr@example.com",
    adminRole: "hr",
  },
  {
    firstName: "Sample",
    lastName: "Director",
    email: "director@example.com",
    adminRole: "director",
  },
];

// Sample employees — emails are placeholders; replace before sending invites.
function employeeSeed(classIdByName: Record<string, string>): NewEmployee[] {
  return [
    {
      firstName: "Alice",
      lastName: "Adams",
      email: "alice@example.com",
      anniversaryDate: "2023-09-01",
      defaultClassId: classIdByName["Infants"]!,
      roleInClass: "teacher",
      scheduledHoursPerWeek: "35",
    },
    {
      firstName: "Bryan",
      lastName: "Brooks",
      email: "bryan@example.com",
      anniversaryDate: "2022-03-15",
      defaultClassId: classIdByName["Ducks"]!,
      roleInClass: "teacher",
      scheduledHoursPerWeek: "40",
    },
    {
      firstName: "Casey",
      lastName: "Carter",
      email: "casey@example.com",
      anniversaryDate: "2024-11-10",
      defaultClassId: classIdByName["Bumblebees"]!,
      roleInClass: "assistant_teacher",
      scheduledHoursPerWeek: "30",
    },
    {
      firstName: "Dana",
      lastName: "Dixon",
      email: "dana@example.com",
      anniversaryDate: "2020-06-22",
      defaultClassId: classIdByName["Panthers"]!,
      roleInClass: "teacher",
      scheduledHoursPerWeek: "40",
    },
    {
      firstName: "Evan",
      lastName: "Ellis",
      email: "evan@example.com",
      anniversaryDate: "2025-01-08",
      defaultClassId: classIdByName["Floater Pool"]!,
      roleInClass: "assistant_teacher",
      scheduledHoursPerWeek: "25",
    },
  ];
}

// Sample 2026 federal holidays (illustrative — admins edit in-app per PRD §5.4).
const holidaySeed: NewHoliday[] = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-19", name: "Martin Luther King Jr. Day" },
  { date: "2026-05-25", name: "Memorial Day" },
  { date: "2026-07-03", name: "Independence Day (observed)" },
  { date: "2026-09-07", name: "Labor Day" },
  { date: "2026-11-26", name: "Thanksgiving" },
  { date: "2026-11-27", name: "Day after Thanksgiving" },
  { date: "2026-12-24", name: "Christmas Eve" },
  { date: "2026-12-25", name: "Christmas Day" },
];

async function main() {
  console.log("Seeding classes…");
  const insertedClasses = await db
    .insert(classes)
    .values(classSeed)
    .onConflictDoNothing()
    .returning();
  const classIdByName: Record<string, string> = Object.fromEntries(
    insertedClasses.map((c) => [c.name, c.id]),
  );
  // Backfill from existing rows if onConflictDoNothing skipped them
  if (Object.keys(classIdByName).length < classSeed.length) {
    const all = await db.select().from(classes);
    for (const c of all) classIdByName[c.name] = c.id;
  }

  console.log("Seeding admins…");
  await db.insert(admins).values(adminSeed).onConflictDoNothing();

  console.log("Seeding employees…");
  await db
    .insert(employees)
    .values(employeeSeed(classIdByName))
    .onConflictDoNothing();

  console.log("Seeding holidays…");
  await db.insert(holidays).values(holidaySeed).onConflictDoNothing();

  console.log("Seeding default settings row…");
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await sql.end();
  });
