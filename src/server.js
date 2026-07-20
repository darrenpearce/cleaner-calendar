'use strict';
require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        app: 'cleaner-calendar',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`Cleaner Calendar running on port ${PORT}`);
});