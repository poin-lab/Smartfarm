import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "data", "smartfarm.sqlite");
const directory = resolve(here, "data", "backups");
if (!existsSync(source))
  throw new Error(
    "Database file does not exist. Start the server once before creating a backup.",
  );
mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = resolve(directory, `smartfarm-${stamp}.sqlite`);
const db = new DatabaseSync(source, { readOnly: true });
try {
  // VACUUM INTO creates a consistent snapshot even when the live DB uses WAL.
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
} finally {
  db.close();
}
console.log(`Backup created: ${target}`);
