require('dotenv').config();

const express = require('express');
const cors = require('cors');
const connectDb = require('./config/database');
const routes = require('./routes'); 
const securityHeaders = require('./middlewares/securityHeaders');

const WebhookController = require('./controllers/WebhookController'); 


const app = express();
app.disable('x-powered-by');

const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

const corsOptions = {
    origin(origin, callback) {
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.includes('*')) {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error(`Origem nao permitida pelo CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
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
