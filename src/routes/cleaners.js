'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const requireAdmin = require('../middleware/adminAuth');
const requireCleaner = require('../middleware/cleanerAuth');

const router = express.Router();

const TOKEN_TTL = '14d';

function attachTasks(bookings) {
    if (!bookings.length) return bookings;
    const ids = bookings.map((b) => b.id);
    const placeholders = ids.map(() => '?').join(',');
    const taskRows = db
        .prepare(
            `SELECT bt.booking_id, t.id, t.name, bt.completed_at
             FROM booking_tasks bt JOIN tasks t ON t.id = bt.task_id
             WHERE bt.booking_id IN (${placeholders})`
        )
        .all(...ids);

    const byBooking = new Map();
    taskRows.forEach((row) => {
        if (!byBooking.has(row.booking_id)) byBooking.set(row.booking_id, []);
        byBooking.get(row.booking_id).push({ id: row.id, name: row.name, completedAt: row.completed_at });
    });

    return bookings.map((b) => ({ ...b, tasks: byBooking.get(b.id) || [] }));
}

// ---- public: names for the login picker ----
router.get('/cleaner/names', (req, res) => {
    const rows = db.prepare('SELECT id, name FROM cleaners ORDER BY name').all();
    res.json({ cleaners: rows });
});

// ---- public: login ----
router.post('/cleaner/login', (req, res) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        return res.status(503).json({ error: 'auth-not-configured' });
    }

    const { cleanerId, pin } = req.body || {};
    if (!cleanerId || !pin) {
        return res.status(400).json({ error: 'missing-fields' });
    }

    const cleaner = db.prepare('SELECT id, name, pin_hash FROM cleaners WHERE id = ?').get(cleanerId);
    if (!cleaner || !bcrypt.compareSync(String(pin), cleaner.pin_hash)) {
        return res.status(401).json({ error: 'invalid-credentials' });
    }

    const token = jwt.sign({ cleanerId: cleaner.id, name: cleaner.name }, secret, { expiresIn: TOKEN_TTL });
    res.json({ token, name: cleaner.name });
});

// ---- cleaner: own jobs ----
router.get('/cleaner/jobs', requireCleaner, (req, res) => {
    const rows = db
        .prepare(
            `SELECT id, name, email, service, date, time, completed_at
             FROM bookings WHERE cleaner_id = ? ORDER BY date, time`
        )
        .all(req.cleaner.id);
    res.json({ jobs: attachTasks(rows) });
});

router.patch('/cleaner/jobs/:id/complete', requireCleaner, (req, res) => {
    const booking = db.prepare('SELECT id, cleaner_id FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking || booking.cleaner_id !== req.cleaner.id) {
        return res.status(404).json({ error: 'not-found' });
    }
    db.prepare("UPDATE bookings SET completed_at = datetime('now') WHERE id = ?").run(booking.id);
    res.json({ ok: true });
});

router.patch('/cleaner/jobs/:id/tasks/:taskId', requireCleaner, (req, res) => {
    const { completed } = req.body || {};
    if (typeof completed !== 'boolean') {
        return res.status(400).json({ error: 'missing-fields' });
    }

    const booking = db.prepare('SELECT id, cleaner_id FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking || booking.cleaner_id !== req.cleaner.id) {
        return res.status(404).json({ error: 'not-found' });
    }

    const result = db
        .prepare(
            `UPDATE booking_tasks SET completed_at = ?
             WHERE booking_id = ? AND task_id = ?`
        )
        .run(completed ? new Date().toISOString() : null, booking.id, req.params.taskId);

    if (result.changes === 0) {
        return res.status(404).json({ error: 'not-found' });
    }
    res.json({ ok: true });
});

// ---- admin: manage cleaners ----
router.get('/admin/cleaners', requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT id, name, created_at FROM cleaners ORDER BY name').all();
    res.json({ cleaners: rows });
});

router.post('/admin/cleaners', requireAdmin, (req, res) => {
    const { name, pin } = req.body || {};
    if (!name || !pin || !/^\d{4,6}$/.test(String(pin))) {
        return res.status(400).json({ error: 'missing-fields' });
    }

    try {
        const pinHash = bcrypt.hashSync(String(pin), 10);
        const result = db.prepare('INSERT INTO cleaners (name, pin_hash) VALUES (?, ?)').run(name.trim(), pinHash);
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'cleaner-exists' });
        }
        console.error(err);
        res.status(500).json({ error: 'server-error' });
    }
});

module.exports = router;
