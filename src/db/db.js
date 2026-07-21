'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'dpdev.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const bookingColumns = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
if (!bookingColumns.includes('cleaner_id')) {
    db.exec('ALTER TABLE bookings ADD COLUMN cleaner_id INTEGER');
}
if (!bookingColumns.includes('completed_at')) {
    db.exec('ALTER TABLE bookings ADD COLUMN completed_at TEXT');
}
if (!bookingColumns.includes('phone')) {
    db.exec("ALTER TABLE bookings ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
}
if (!bookingColumns.includes('address')) {
    db.exec("ALTER TABLE bookings ADD COLUMN address TEXT NOT NULL DEFAULT ''");
}

const cleanerColumns = db.prepare("PRAGMA table_info(cleaners)").all().map((c) => c.name);
if (!cleanerColumns.includes('phone')) {
    db.exec("ALTER TABLE cleaners ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
}

const bookingsTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bookings'").get();
if (bookingsTableSql && /UNIQUE\s*\(\s*date\s*,\s*time\s*\)/i.test(bookingsTableSql.sql)) {
    db.exec(`
        CREATE TABLE bookings_rebuild (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          address TEXT NOT NULL,
          service TEXT NOT NULL,
          date TEXT NOT NULL,
          time TEXT NOT NULL,
          cleaner_id INTEGER,
          completed_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO bookings_rebuild (id, name, email, phone, address, service, date, time, cleaner_id, completed_at, created_at)
          SELECT id, name, email, phone, address, service, date, time, cleaner_id, completed_at, created_at FROM bookings;
        DROP TABLE bookings;
        ALTER TABLE bookings_rebuild RENAME TO bookings;
    `);
}

const bookingTaskColumns = db.prepare("PRAGMA table_info(booking_tasks)").all().map((c) => c.name);
if (!bookingTaskColumns.includes('name')) {
    db.exec("ALTER TABLE booking_tasks ADD COLUMN name TEXT NOT NULL DEFAULT ''");
    db.exec(`
        UPDATE booking_tasks
        SET name = COALESCE((SELECT t.name FROM tasks t WHERE t.id = booking_tasks.task_id), '')
        WHERE name = ''
    `);
}

module.exports = db;
