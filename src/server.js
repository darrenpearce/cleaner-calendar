'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bookingsRouter = require('./routes/bookings');

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = (
    process.env.ALLOWED_ORIGINS ||
    'https://darrenpearce.github.io,http://localhost:5500,http://127.0.0.1:5500'
)
    .split(',')
    .map((origin) => origin.trim());

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        app: 'cleaner-calendar',
        timestamp: new Date().toISOString()
    });
});

app.use('/api', bookingsRouter);

app.listen(PORT, () => {
    console.log(`Cleaner Calendar running on port ${PORT}`);
});