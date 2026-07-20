'use strict';
const express = require('express');
const db = require('../db/db');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/availability', (req, res) => {
    const { date } = req.query;
    if (!date || !DATE_RE.test(date)) {
        return res.status(400).json({ error: 'invalid-date' });
    }

    const rows = db.prepare('SELECT time FROM bookings WHERE date = ?').all(date);
    res.json({ bookedSlots: rows.map((r) => r.time) });
});

router.post('/bookings', (req, res) => {
    const { name, email, service, date, time } = req.body || {};
    if (!name || !email || !service || !date || !time) {
        return res.status(400).json({ error: 'missing-fields' });
    }
    if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: 'invalid-date' });
    }

    try {
        const result = db
            .prepare('INSERT INTO bookings (name, email, service, date, time) VALUES (?, ?, ?, ?, ?)')
            .run(name, email, service, date, time);
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'slot-taken' });
        }
        console.error(err);
        res.status(500).json({ error: 'server-error' });
    }
});

module.exports = router;
