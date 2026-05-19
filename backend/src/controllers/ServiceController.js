const connectDb = require('../config/database');
const { isNonEmptyString, isNonNegativeMoney, toMoney } = require('../utils/validators');

module.exports = {
    async create(req, res) {
        try {
            const { name, default_price, description } = req.body;

            if (!isNonEmptyString(name, 100)) {
                return res.status(400).json({ error: 'Informe o nome do servico.' });
            }

            if (default_price !== undefined && !isNonNegativeMoney(default_price)) {
                return res.status(400).json({ error: 'Valor padrao invalido.' });
            }

            const db = await connectDb();
            const result = await db.run(`
                INSERT INTO services (user_id, name, default_price, description)
                VALUES (?, ?, ?, ?)
            `, [req.userId, name.trim(), toMoney(default_price), description || null]);

            return res.status(201).json({ id: result.lastID, message: 'Servico cadastrado.' });
        } catch (error) {
            console.error('[ServiceController.create]', error);
            return res.status(500).json({ error: 'Erro ao cadastrar servico.' });
        }
    },

    async index(req, res) {
        try {
            const db = await connectDb();
            const services = await db.all(`
                SELECT * FROM services
                WHERE user_id = ? AND active = 1
                ORDER BY name ASC
            `, [req.userId]);

            return res.json(services);
        } catch (error) {
            console.error('[ServiceController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar servicos.' });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const { name, default_price, description } = req.body;
            const db = await connectDb();

            if (name !== undefined && !isNonEmptyString(name, 100)) {
                return res.status(400).json({ error: 'Nome invalido.' });
            }

            if (default_price !== undefined && !isNonNegativeMoney(default_price)) {
                return res.status(400).json({ error: 'Valor padrao invalido.' });
            }

            const result = await db.run(`
                UPDATE services
                SET name = COALESCE(?, name),
                    default_price = COALESCE(?, default_price),
                    description = COALESCE(?, description)
                WHERE id = ? AND user_id = ? AND active = 1
            `, [
                name && name.trim() ? name.trim() : null,
                default_price === undefined ? null : toMoney(default_price),
                description === undefined ? null : description,
                id,
                req.userId
            ]);

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Servico nao encontrado.' });
            }

            return res.json({ message: 'Servico atualizado.' });
        } catch (error) {
            console.error('[ServiceController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar servico.' });
        }
    },

    async destroy(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const result = await db.run(
                'UPDATE services SET active = 0 WHERE id = ? AND user_id = ?',
                [id, req.userId]
            );

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Servico nao encontrado.' });
            }

            return res.json({ message: 'Servico arquivado.' });
        } catch (error) {
            console.error('[ServiceController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao arquivar servico.' });
        }
    }
};
