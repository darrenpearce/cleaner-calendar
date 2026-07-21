'use strict';
const express = require('express');
const db = require('../db/db');
const requireAdmin = require('../middleware/adminAuth');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPEAT_OPTIONS = ['none', 'weekly', 'biweekly', 'monthly', 'yearly'];
const REPEAT_OCCURRENCES = 26;

function occurrenceDate(startDate, repeat, index) {
    const d = new Date(startDate + 'T00:00:00');
    if (repeat === 'weekly') d.setDate(d.getDate() + 7 * index);
    else if (repeat === 'biweekly') d.setDate(d.getDate() + 14 * index);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + index);
    else if (repeat === 'yearly') d.setFullYear(d.getFullYear() + index);
    return d.toISOString().slice(0, 10);
}

function slotCapacity(date) {
    const totalStaff = db.prepare('SELECT COUNT(*) AS c FROM cleaners').get().c;
    const unavailable = db.prepare('SELECT COUNT(*) AS c FROM cleaner_unavailability WHERE date = ?').get(date).c;
    return Math.max(totalStaff - unavailable, 0);
}

function slotBookedCount(date, time) {
    return db.prepare('SELECT COUNT(*) AS c FROM bookings WHERE date = ? AND time = ?').get(date, time).c;
}

const insertBookingSeries = db.transaction((name, email, phone, address, service, date, time, taskIds, repeat) => {
    const insertBooking = db.prepare(
        'INSERT INTO bookings (name, email, phone, address, service, date, time) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertTask = db.prepare('INSERT INTO booking_tasks (booking_id, task_id, name) VALUES (?, ?, ?)');

    const taskNames = new Map();
    if (taskIds.length) {
        const placeholders = taskIds.map(() => '?').join(',');
        db.prepare(`SELECT id, name FROM tasks WHERE id IN (${placeholders})`)
            .all(...taskIds)
            .forEach((t) => taskNames.set(t.id, t.name));
    }

    const count = repeat === 'none' ? 1 : REPEAT_OCCURRENCES;
    let firstId = null;
    let bookedCount = 0;
    const skippedDates = [];

    for (let i = 0; i < count; i++) {
        const occDate = occurrenceDate(date, repeat, i);
        if (slotBookedCount(occDate, time) >= slotCapacity(occDate)) {
            skippedDates.push(occDate);
            continue;
        }

        const result = insertBooking.run(name, email, phone, address, service, occDate, time);
        taskIds.forEach((taskId) => insertTask.run(result.lastInsertRowid, taskId, taskNames.get(taskId) || ''));
        if (firstId === null) firstId = result.lastInsertRowid;
        bookedCount++;
    }

    return { firstId, bookedCount, skippedDates };
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

    const rows = db.prepare('SELECT time, COUNT(*) AS cnt FROM bookings WHERE date = ? GROUP BY time').all(date);
    const bookedCounts = {};
    rows.forEach((r) => { bookedCounts[r.time] = r.cnt; });

    res.json({ capacity: slotCapacity(date), bookedCounts });
});

router.post('/bookings', (req, res) => {
    const { name, email, phone, address, service, date, time, taskIds, repeat } = req.body || {};
    if (!name || !email || !phone || !address || !service || !date || !time) {
        return res.status(400).json({ error: 'missing-fields' });
    }
    if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: 'invalid-date' });
    }

    const repeatValue = REPEAT_OPTIONS.includes(repeat) ? repeat : 'none';
    const cleanTaskIds = Array.isArray(taskIds) ? taskIds.filter((id) => Number.isInteger(id)) : [];

    try {
        const result = insertBookingSeries(name, email, phone, address, service, date, time, cleanTaskIds, repeatValue);
        if (result.bookedCount === 0) {
            return res.status(409).json({ error: 'slot-taken' });
        }
        res.status(201).json({ id: result.firstId, bookedCount: result.bookedCount, skippedDates: result.skippedDates });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'server-error' });
    }
});

router.get('/bookings', requireAdmin, (req, res) => {
    const bookings = db
        .prepare(
            `SELECT b.id, b.name, b.email, b.phone, b.address, b.service, b.date, b.time, b.completed_at, b.created_at,
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
            `SELECT booking_id, task_id AS id, name, completed_at
             FROM booking_tasks WHERE booking_id IN (${placeholders})`
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
