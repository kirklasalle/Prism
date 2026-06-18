import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const dbPath = join(homedir(), "Documents", "Prism_Refraction", "state", "prism-activity.db");
try {
    const db = new DatabaseSync(dbPath);
    console.log("Tables:");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log(tables);
} catch (err) {
    console.error("Error:", err);
}
