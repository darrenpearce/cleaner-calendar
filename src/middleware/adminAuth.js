'use strict';
const crypto = require('crypto');

function requireAdmin(req, res, next) {
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey) {
        return res.status(503).json({ error: 'admin-not-configured' });
    }

    const provided = req.get('X-Admin-Key') || '';
    const expected = Buffer.from(adminKey);
    const actual = Buffer.from(provided);

    const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    if (!match) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    next();
}

module.exports = requireAdmin;
