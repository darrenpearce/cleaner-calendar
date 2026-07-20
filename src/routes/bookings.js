'use strict';
const express = require('express');
const db = require('../db/db');
const requireAdmin = require('../middleware/adminAuth');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const insertBookingWithTasks = db.transaction((name, email, service, date, time, taskIds) => {
    const result = db
        .prepare('INSERT INTO bookings (name, email, service, date, time) VALUES (?, ?, ?, ?, ?)')
        .run(name, email, service, date, time);

    const insertTask = db.prepare('INSERT INTO booking_tasks (booking_id, task_id) VALUES (?, ?)');
    taskIds.forEach((taskId) => insertTask.run(result.lastInsertRowid, taskId));

    return result.lastInsertRowid;
});

const deleteBooking = db.transaction((id) => {
    db.prepare('DELETE FROM booking_tasks WHERE booking_id = ?').run(id);
    return db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
});

router.get('/availability', (req, res) => {
    const { date } = req.query;
    if (!date || !DATE_RE.test(date)) {
        return res.status(400).json({ error: 'invalid-date' });
    }

    const rows = db.prepare('SELECT time FROM bookings WHERE date = ?').all(date);
    res.json({ bookedSlots: rows.map((r) => r.time) });
});

router.post('/bookings', (req, res) => {
    const { name, email, service, date, time, taskIds } = req.body || {};
    if (!name || !email || !service || !date || !time) {
        return res.status(400).json({ error: 'missing-fields' });
    }
    if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: 'invalid-date' });
    }

    const cleanTaskIds = Array.isArray(taskIds) ? taskIds.filter((id) => Number.isInteger(id)) : [];

    try {
        const id = insertBookingWithTasks(name, email, service, date, time, cleanTaskIds);
        res.status(201).json({ id });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'slot-taken' });
        }
        console.error(err);
        res.status(500).json({ error: 'server-error' });
    }
});

router.get('/bookings', requireAdmin, (req, res) => {
    const bookings = db
        .prepare(
            `SELECT b.id, b.name, b.email, b.service, b.date, b.time, b.completed_at, b.created_at,
                    b.cleaner_id, c.name AS cleaner_name
             FROM bookings b LEFT JOIN cleaners c ON c.id = b.cleaner_id
             ORDER BY b.date, b.time`
        )
        .all();

    if (!bookings.length) {
        return res.json({ bookings: [] });
    }

    const ids = bookings.map((b) => b.id);
    const placeholders = ids.map(() => '?').join(',');
    const taskRows = db
        .prepare(
            `SELECT bt.booking_id, t.id, t.name, bt.completed_at
             FROM booking_tasks bt JOIN tasks t ON t.id = bt.task_id
             WHERE bt.booking_id IN (${placeholders})`
        )
        .all(...ids);

    const tasksByBooking = new Map();
    taskRows.forEach((row) => {
        if (!tasksByBooking.has(row.booking_id)) tasksByBooking.set(row.booking_id, []);
        tasksByBooking.get(row.booking_id).push({ id: row.id, name: row.name, completedAt: row.completed_at });
    });

    res.json({ bookings: bookings.map((b) => ({ ...b, tasks: tasksByBooking.get(b.id) || [] })) });
});

router.patch('/bookings/:id/assign', requireAdmin, (req, res) => {
    const { cleanerId } = req.body || {};
    if (cleanerId !== null && !Number.isInteger(cleanerId)) {
        return res.status(400).json({ error: 'missing-fields' });
    }

    const result = db.prepare('UPDATE bookings SET cleaner_id = ? WHERE id = ?').run(cleanerId, req.params.id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'not-found' });
    }
    res.json({ ok: true });
});

router.delete('/bookings/:id', requireAdmin, (req, res) => {
    const result = deleteBooking(req.params.id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'not-found' });
    }
    res.json({ ok: true });
});

module.exports = router;
