import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const dbPath = join(homedir(), "Documents", "Prism_Refraction", "state", "prism-activity.db");
try {
    const db = new DatabaseSync(dbPath);
    const columns = db.prepare("PRAGMA table_info(chat_sessions)").all();
    console.log("Columns of chat_sessions:", columns.map(c => c.name));
    const sessions = db.prepare("SELECT * FROM chat_sessions").all();
    console.log("Chat Sessions count:", sessions.length);
    for (const s of sessions) {
        console.log(s);
    }
} catch (err) {
    console.error("Error:", err);
}
