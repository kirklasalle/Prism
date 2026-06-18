import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const paths = [
    join(process.cwd(), "prism-activity.db"),
    join(homedir(), "Documents", "Prism_Refraction", "state", "prism-activity.db"),
    join(homedir(), "Documents", "Prism", "state", "prism-activity.db")
];

for (const dbPath of paths) {
    if (!existsSync(dbPath)) {
        console.log(`DB Path ${dbPath} does not exist.`);
        continue;
    }
    console.log(`Checking DB: ${dbPath}`);
    try {
        const db = new DatabaseSync(dbPath);
        
        // Let's check tables
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log("Tables:", tables.map(t => t.name));
        
        if (tables.some(t => t.name === 'activity_events')) {
            const rowCount = db.prepare("SELECT COUNT(*) as cnt FROM activity_events").all()[0].cnt;
            console.log(`activity_events row count: ${rowCount}`);
            
            // Let's get the 10 most recent goal submissions or autonomous loop logs
            const recentEvents = db.prepare("SELECT * FROM activity_events WHERE operation LIKE '%goal%' ORDER BY timestamp DESC LIMIT 20").all();
            console.log("Recent goal events:");
            for (const e of recentEvents) {
                console.log(`- [${e.operation}] ${e.timestamp}: ${e.details}`);
            }
        }
    } catch (err) {
        console.error("Error checking", dbPath, ":", err);
    }
    console.log("---------------------------------------");
}
