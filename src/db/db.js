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

module.exports = db;
