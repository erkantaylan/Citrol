import { SQL } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";

export const sql = new SQL(config.databaseUrl);

const migrationsDir = join(import.meta.dir, "..", "migrations");

// Runs every .sql file in migrations/ that hasn't run yet, in name order.
// Migrations only ever add: changing an applied file does nothing, write a new one.
export async function migrate() {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const applied = new Set(
    (await sql`select name from schema_migrations`).map((row: { name: string }) => row.name),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await Bun.file(join(migrationsDir, file)).text();
    await sql.begin(async (tx) => {
      await tx.unsafe(text).simple();
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`migration applied: ${file}`);
  }
}
