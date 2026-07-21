CREATE TABLE IF NOT EXISTS cleaners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
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

CREATE TABLE IF NOT EXISTS booking_tasks (
  booking_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  PRIMARY KEY (booking_id, task_id)
);

CREATE TABLE IF NOT EXISTS cleaner_unavailability (
  cleaner_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (cleaner_id, date)
);
