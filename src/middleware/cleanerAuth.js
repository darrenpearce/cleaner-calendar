'use strict';
const jwt = require('jsonwebtoken');

function requireCleaner(req, res, next) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        return res.status(503).json({ error: 'auth-not-configured' });
    }

    const header = req.get('Authorization') || '';
    const match = header.match(/^Bearer (.+)$/);
    if (!match) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    try {
        const payload = jwt.verify(match[1], secret);
        req.cleaner = { id: payload.cleanerId, name: payload.name };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'unauthorized' });
    }
}

module.exports = requireCleaner;
