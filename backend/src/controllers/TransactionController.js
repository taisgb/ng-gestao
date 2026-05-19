const connectDb = require('../config/database');
const { isDate, isNonEmptyString, isNonNegativeMoney, toMoney } = require('../utils/validators');

async function getAccessibleProject(db, projectId, userId) {
    return db.get(`
        SELECT p.*
        FROM projects p
        LEFT JOIN project_members pm 
            ON pm.project_id = p.id AND pm.user_id = ?
        WHERE p.id = ?
          AND p.archived = 0
          AND (p.user_id = ? OR pm.user_id IS NOT NULL)
    `, [userId, projectId, userId]);
}

module.exports = {
    async create(req, res) {
        try {
            const { type, entity, category, amount, date, description, project_id } = req.body;

            if (!['Receita', 'Despesa'].includes(type) || !isNonNegativeMoney(amount) || toMoney(amount) === 0 || !isDate(date)) {
                return res.status(400).json({ error: 'Tipo, valor positivo e data valida sao obrigatorios.' });
            }

            if (!isNonEmptyString(category, 80)) {
                return res.status(400).json({ error: 'Categoria e obrigatoria.' });
            }

            const db = await connectDb();

            const user = await db.get('SELECT plan FROM users WHERE id = ?', [req.userId]);

            if (user.plan === 'free') {
                const currentMonth = new Date().toISOString().slice(0, 7);
                const count = await db.get(`
                    SELECT COUNT(*) as total FROM transactions 
                    WHERE user_id = ? AND strftime('%Y-%m', date) = ?
                `, [req.userId, currentMonth]);

                if (count.total >= 20) {
                    return res.status(403).json({
                        error: 'Limite de 20 lancamentos mensais atingido no plano Free. Faca upgrade para lancamentos ilimitados!'
                    });
                }
            }

            if (project_id) {
                const projectCheck = await getAccessibleProject(db, project_id, req.userId);
                if (!projectCheck) {
                    return res.status(403).json({ error: 'Voce nao tem permissao para vincular transacoes a este projeto.' });
                }
            }

            const result = await db.run(`
                INSERT INTO transactions (type, entity, category, amount, date, description, project_id, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [type, entity || 'MEI', category.trim(), toMoney(amount), date, description || null, project_id || null, req.userId]);

            return res.status(201).json({ id: result.lastID, message: 'Lancamento realizado com sucesso!' });
        } catch (error) {
            console.error('[TransactionController.create]', error);
            return res.status(500).json({ error: 'Erro ao registrar transacao.' });
        }
    },

    async index(req, res) {
        try {
            const { month, year, entity, project_id } = req.query;
            const db = await connectDb();

            let query = 'SELECT * FROM transactions WHERE user_id = ?';
            const params = [req.userId];

            if (project_id) {
                const project = await getAccessibleProject(db, project_id, req.userId);
                if (!project) {
                    return res.status(403).json({ error: 'Voce nao tem acesso a este projeto.' });
                }

                query = 'SELECT * FROM transactions WHERE project_id = ? AND user_id = ?';
                params.length = 0;
                params.push(project_id, req.userId);
            }

            if (entity) {
                query += ' AND entity = ?';
                params.push(entity);
            }

            if (month && year) {
                query += " AND strftime('%m', date) = ? AND strftime('%Y', date) = ?";
                params.push(month.padStart(2, '0'), year);
            }

            query += ' ORDER BY date DESC';

            const transactions = await db.all(query, params);
            return res.json(transactions);
        } catch (error) {
            console.error('[TransactionController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar transacoes.' });
        }
    },

    async destroy(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const result = await db.run('DELETE FROM transactions WHERE id = ? AND user_id = ?', [id, req.userId]);

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Transacao nao encontrada ou acesso negado.' });
            }

            return res.json({ message: 'Lancamento removido.' });
        } catch (error) {
            console.error('[TransactionController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao remover transacao.' });
        }
    }
};
