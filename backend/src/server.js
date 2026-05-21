require('dotenv').config();

const express = require('express');
const cors = require('cors');
const connectDb = require('./config/database');
const routes = require('./routes'); 
const securityHeaders = require('./middlewares/securityHeaders');

const WebhookController = require('./controllers/WebhookController'); 


const app = express();
app.disable('x-powered-by');

function normalizeOrigin(origin) {
    if (!origin) return '';

    try {
        const parsed = new URL(origin.trim());
        return parsed.origin;
    } catch {
        return origin.trim().replace(/\/$/, '');
    }
}

const configuredOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

const allowedOrigins = Array.from(new Set([
    ...configuredOrigins,
    process.env.FRONTEND_URL,
    'https://ng-gestao.vercel.app',
    'https://ng-gestao-zdmz.onrender.com'
].filter(Boolean).map(origin => origin === '*' ? '*' : normalizeOrigin(origin))));

const corsOptions = {
    origin(origin, callback) {
        if (!origin) {
            return callback(null, true);
        }

        const normalizedOrigin = normalizeOrigin(origin);

        if (allowedOrigins.includes('*')) {
            return callback(null, true);
        }

        if (allowedOrigins.includes(normalizedOrigin)) {
            return callback(null, true);
        }

        console.warn(`Origem não permitida pelo CORS: ${origin}`);
        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    return next();
});
app.use(securityHeaders);

// 2.  ROTA DO WEBHOOK 
app.post('/webhook', express.raw({ type: 'application/json' }), WebhookController.handle);

// 3. Daqui para baixo, o servidor volta a tratar tudo como JSON normal
app.use(express.json({ limit: '1mb' }));

app.use(routes);

// Inicia o banco e DEPOIS liga o servidor
connectDb().then(() => {
    const PORT = process.env.PORT || 3333;
    app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
    });
}).catch(err => {
    console.error('Erro ao iniciar o banco de dados:', err);
});
