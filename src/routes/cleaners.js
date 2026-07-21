'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const requireAdmin = require('../middleware/adminAuth');
const requireCleaner = require('../middleware/cleanerAuth');

const router = express.Router();

const TOKEN_TTL = '14d';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function attachTasks(bookings) {
    if (!bookings.length) return bookings;
    const ids = bookings.map((b) => b.id);
    const placeholders = ids.map(() => '?').join(',');
    const taskRows = db
        .prepare(
            `SELECT booking_id, task_id AS id, name, completed_at
             FROM booking_tasks WHERE booking_id IN (${placeholders})`
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
            `SELECT id, name, email, phone, address, service, date, time, completed_at
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

router.get('/cleaner/unavailability', requireCleaner, (req, res) => {
    const rows = db
        .prepare('SELECT date FROM cleaner_unavailability WHERE cleaner_id = ? ORDER BY date')
        .all(req.cleaner.id);
    res.json({ dates: rows.map((r) => r.date) });
});

router.post('/cleaner/unavailability', requireCleaner, (req, res) => {
    const { date } = req.body || {};
    if (!date || !DATE_RE.test(date)) {
        return res.status(400).json({ error: 'invalid-date' });
    }

    db.prepare('INSERT OR IGNORE INTO cleaner_unavailability (cleaner_id, date) VALUES (?, ?)').run(req.cleaner.id, date);
    res.status(201).json({ ok: true });
});

router.delete('/cleaner/unavailability/:date', requireCleaner, (req, res) => {
    db.prepare('DELETE FROM cleaner_unavailability WHERE cleaner_id = ? AND date = ?').run(req.cleaner.id, req.params.date);
    res.json({ ok: true });
});

// ---- admin: manage cleaners ----
router.get('/admin/cleaners', requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT id, name, phone, created_at FROM cleaners ORDER BY name').all();
    res.json({ cleaners: rows });
});

router.get('/admin/unavailability', requireAdmin, (req, res) => {
    const { date } = req.query;
    if (!date || !DATE_RE.test(date)) {
        return res.status(400).json({ error: 'invalid-date' });
    }

    const rows = db.prepare('SELECT cleaner_id FROM cleaner_unavailability WHERE date = ?').all(date);
    res.json({ cleanerIds: rows.map((r) => r.cleaner_id) });
});

router.get('/admin/unavailability/month', requireAdmin, (req, res) => {
    const { month } = req.query;
    if (!month || !MONTH_RE.test(month)) {
        return res.status(400).json({ error: 'invalid-month' });
    }

    const rows = db
        .prepare('SELECT cleaner_id AS cleanerId, date FROM cleaner_unavailability WHERE date LIKE ? ORDER BY date')
        .all(month + '-%');
    res.json({ entries: rows });
});

router.post('/admin/cleaners', requireAdmin, (req, res) => {
    const { name, phone, pin } = req.body || {};
    if (!name || !phone || !pin || !/^\d{4,6}$/.test(String(pin))) {
        return res.status(400).json({ error: 'missing-fields' });
    }

    try {
        const pinHash = bcrypt.hashSync(String(pin), 10);
        const result = db
            .prepare('INSERT INTO cleaners (name, phone, pin_hash) VALUES (?, ?, ?)')
            .run(name.trim(), phone.trim(), pinHash);
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'cleaner-exists' });
        }
        console.error(err);
        res.status(500).json({ error: 'server-error' });
    }
});

router.patch('/admin/cleaners/:id/phone', requireAdmin, (req, res) => {
    const { phone } = req.body || {};
    if (!phone || !phone.trim()) {
        return res.status(400).json({ error: 'missing-fields' });
    }

    const result = db.prepare('UPDATE cleaners SET phone = ? WHERE id = ?').run(phone.trim(), req.params.id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'not-found' });
    }
    res.json({ ok: true });
});

router.patch('/admin/cleaners/:id/pin', requireAdmin, (req, res) => {
    const { pin } = req.body || {};
    if (!pin || !/^\d{4,6}$/.test(String(pin))) {
        return res.status(400).json({ error: 'missing-fields' });
    }

    const pinHash = bcrypt.hashSync(String(pin), 10);
    const result = db.prepare('UPDATE cleaners SET pin_hash = ? WHERE id = ?').run(pinHash, req.params.id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'not-found' });
    }
    res.json({ ok: true });
});

const deleteCleaner = db.transaction((id) => {
    db.prepare('UPDATE bookings SET cleaner_id = NULL WHERE cleaner_id = ?').run(id);
    db.prepare('DELETE FROM cleaner_unavailability WHERE cleaner_id = ?').run(id);
    return db.prepare('DELETE FROM cleaners WHERE id = ?').run(id);
});

router.delete('/admin/cleaners/:id', requireAdmin, (req, res) => {
    const result = deleteCleaner(req.params.id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'not-found' });
    }
    res.json({ ok: true });
});

module.exports = router;
