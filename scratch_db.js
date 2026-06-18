import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('C:\\Users\\kirkl\\Documents\\Prism_Refraction\\state\\prism-activity.db');

db.all("SELECT * FROM activity_events ORDER BY timestamp DESC LIMIT 20", [], (err, rows) => {
  if (err) {
    console.error(err);
  } else {
    console.log("Latest events:", rows.map(r => ({
      timestamp: r.timestamp,
      operation: r.operation,
      status: r.status,
      details: r.details
    })));
  }
  db.close();
});
