const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const connectDb = require('../config/database');
const { isEmail, isNonEmptyString, normalizeEmail } = require('../utils/validators');

module.exports = {
    async store(req, res) {
        try {
            const email = normalizeEmail(req.body.email);
            const { password } = req.body;

            if (!isEmail(email) || !isNonEmptyString(password, 128)) {
                return res.status(400).json({ error: 'Email e senha sao obrigatorios.' });
            }

            if (!process.env.APP_SECRET) {
                return res.status(500).json({ error: 'Configuracao de autenticacao ausente.' });
            }

            const db = await connectDb();
            const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);

            if (!user) {
                return res.status(401).json({ error: 'Credenciais invalidas.' });
            }

            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                return res.status(401).json({ error: 'Credenciais invalidas.' });
            }

            const { id, name, plan } = user;

            return res.json({
                user: { id, name, email, plan },
                token: jwt.sign({ id }, process.env.APP_SECRET, { expiresIn: '7d' }),
            });
        } catch (error) {
            console.error('[SessionController.store]', error);
            return res.status(500).json({ error: 'Erro ao processar a autenticacao.' });
        }
    }
};
