'use strict';
const express = require('express');
const db = require('../db/db');
const requireAdmin = require('../middleware/adminAuth');

const router = express.Router();

router.get('/tasks', (req, res) => {
    const rows = db.prepare('SELECT id, name FROM tasks WHERE active = 1 ORDER BY name').all();
    res.json({ tasks: rows });
});

router.get('/admin/tasks', requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT id, name, active FROM tasks ORDER BY name').all();
    res.json({ tasks: rows });
});

router.post('/admin/tasks', requireAdmin, (req, res) => {
    const name = (req.body && req.body.name || '').trim();
    if (!name) {
        return res.status(400).json({ error: 'missing-fields' });
    }

    try {
        const result = db.prepare('INSERT INTO tasks (name) VALUES (?)').run(name);
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'task-exists' });
        }
        console.error(err);
        res.status(500).json({ error: 'server-error' });
    }
});

router.patch('/admin/tasks/:id', requireAdmin, (req, res) => {
    const { active } = req.body || {};
    if (typeof active !== 'boolean') {
        return res.status(400).json({ error: 'missing-fields' });
    }

    const result = db.prepare('UPDATE tasks SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'not-found' });
    }
    res.json({ ok: true });
});

router.delete('/admin/tasks/:id', requireAdmin, (req, res) => {
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
        return res.status(404).json({ error: 'not-found' });
    }
    res.json({ ok: true });
});

module.exports = router;
