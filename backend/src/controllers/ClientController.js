const connectDb = require('../config/database');
const { isEmail, isNonEmptyString, normalizeEmail } = require('../utils/validators');

module.exports = {
    async create(req, res) {
        try {
            const { name, contact_name, phone, document } = req.body;
            const email = req.body.email ? normalizeEmail(req.body.email) : null;
            const userId = req.userId;

            if (!isNonEmptyString(name, 160) || (email && !isEmail(email))) {
                return res.status(400).json({ error: 'Nome do cliente ou email invalido.' });
            }

            const db = await connectDb();
            const user = await db.get('SELECT plan FROM users WHERE id = ?', [userId]);

            if (user.plan === 'free') {
                const count = await db.get(
                    'SELECT COUNT(*) as total FROM clients WHERE user_id = ? AND archived = 0',
                    [userId]
                );

                if (count.total >= 3) {
                    return res.status(403).json({
                        error: 'Limite de 3 clientes atingido no plano Free. Faca o upgrade para expandir sua carteira!'
                    });
                }
            }

            const result = await db.run(`
                INSERT INTO clients (user_id, name, contact_name, phone, email, document)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [userId, name.trim(), contact_name || null, phone || null, email, document || null]);

            return res.status(201).json({ id: result.lastID, message: 'Cliente cadastrado com sucesso!' });
        } catch (error) {
            console.error('[ClientController.create]', error);
            return res.status(500).json({ error: 'Erro ao cadastrar cliente.' });
        }
    },

    async index(req, res) {
        try {
            const db = await connectDb();
            const clients = await db.all(`
                SELECT * FROM clients 
                WHERE user_id = ? AND archived = 0 
                ORDER BY name ASC
            `, [req.userId]);

            return res.json(clients);
        } catch (error) {
            console.error('[ClientController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar clientes.' });
        }
    },

    async show(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const client = await db.get(
                'SELECT * FROM clients WHERE id = ? AND user_id = ? AND archived = 0',
                [id, req.userId]
            );

            if (!client) {
                return res.status(404).json({ error: 'Cliente nao encontrado ou acesso negado.' });
            }

            return res.json(client);
        } catch (error) {
            console.error('[ClientController.show]', error);
            return res.status(500).json({ error: 'Erro ao buscar detalhes do cliente.' });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const { name, contact_name, phone, document } = req.body;
            const email = req.body.email ? normalizeEmail(req.body.email) : req.body.email;
            const db = await connectDb();

            if (name !== undefined && !isNonEmptyString(name, 160)) {
                return res.status(400).json({ error: 'Nome do cliente invalido.' });
            }

            if (email && !isEmail(email)) {
                return res.status(400).json({ error: 'Email invalido.' });
            }

            const result = await db.run(`
                UPDATE clients 
                SET name = COALESCE(?, name),
                    contact_name = COALESCE(?, contact_name),
                    phone = COALESCE(?, phone),
                    email = COALESCE(?, email),
                    document = COALESCE(?, document)
                WHERE id = ? AND user_id = ?
            `, [name === undefined ? null : name.trim(), contact_name, phone, email, document, id, req.userId]);

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Cliente nao encontrado ou sem permissao.' });
            }

            return res.json({ message: 'Dados do cliente atualizados.' });
        } catch (error) {
            console.error('[ClientController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar cliente.' });
        }
    },

    async destroy(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const result = await db.run(
                'UPDATE clients SET archived = 1 WHERE id = ? AND user_id = ?',
                [id, req.userId]
            );

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Cliente nao encontrado.' });
            }

            return res.json({ message: 'Cliente arquivado com sucesso.' });
        } catch (error) {
            console.error('[ClientController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao arquivar cliente.' });
        }
    }
};
