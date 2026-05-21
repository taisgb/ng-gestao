const connectDb = require('../config/database');
const { isDate, isNonEmptyString, isNonNegativeMoney, toMoney } = require('../utils/validators');

async function ensurePersonalStatus(db, userId) {
    await db.run(`
        INSERT OR IGNORE INTO personal_status (user_id, total_bank_balance, total_debt, credit_card_bill)
        VALUES (?, 0, 0, 0)
    `, [userId]);
}

module.exports = {
    async getDashboard(req, res) {
        try {
            const db = await connectDb();
            await ensurePersonalStatus(db, req.userId);

            const status = await db.get('SELECT * FROM personal_status WHERE user_id = ?', [req.userId]);
            const renegotiations = await db.get(
                'SELECT SUM(installment_value) as total FROM renegotiations WHERE active = 1 AND user_id = ?',
                [req.userId]
            );

            return res.json({
                bank_balance: status.total_bank_balance,
                total_debt: status.total_debt,
                current_card_bill: status.credit_card_bill,
                fixed_debts_month: renegotiations.total || 0,
                updated_at: status.updated_at
            });
        } catch (error) {
            console.error('[PersonalController.getDashboard]', error);
            return res.status(500).json({ error: 'Erro ao carregar dashboard pessoal.' });
        }
    },

    async updateStatus(req, res) {
        try {
            const { total_bank_balance, total_debt, credit_card_bill } = req.body;
            const db = await connectDb();
            await ensurePersonalStatus(db, req.userId);

            if (
                (total_bank_balance !== undefined && !Number.isFinite(Number(total_bank_balance))) ||
                (total_debt !== undefined && !isNonNegativeMoney(total_debt)) ||
                (credit_card_bill !== undefined && !isNonNegativeMoney(credit_card_bill))
            ) {
                return res.status(400).json({ error: 'Valores financeiros inválidos.' });
            }

            await db.run(`
                UPDATE personal_status 
                SET total_bank_balance = COALESCE(?, total_bank_balance),
                    total_debt = COALESCE(?, total_debt),
                    credit_card_bill = COALESCE(?, credit_card_bill),
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            `, [
                total_bank_balance === undefined ? null : toMoney(total_bank_balance),
                total_debt === undefined ? null : toMoney(total_debt),
                credit_card_bill === undefined ? null : toMoney(credit_card_bill),
                req.userId
            ]);

            return res.json({ message: 'Status financeiro atualizado!' });
        } catch (error) {
            console.error('[PersonalController.updateStatus]', error);
            return res.status(500).json({ error: 'Erro ao atualizar status.' });
        }
    },

    async createRenegotiation(req, res) {
        try {
            const { description, installment_value, total_installments, start_date } = req.body;

            if (!isNonEmptyString(description, 160) || !isNonNegativeMoney(installment_value) || toMoney(installment_value) === 0 || !isDate(start_date)) {
                return res.status(400).json({ error: 'Descrição, parcela positiva e data inicial são obrigatórias.' });
            }

            const db = await connectDb();

            const result = await db.run(`
                INSERT INTO renegotiations (user_id, description, installment_value, total_installments, start_date)
                VALUES (?, ?, ?, ?, ?)
            `, [req.userId, description.trim(), toMoney(installment_value), Number(total_installments || 0), start_date]);

            return res.status(201).json({ id: result.lastID, message: 'Renegociação cadastrada!' });
        } catch (error) {
            console.error('[PersonalController.createRenegotiation]', error);
            return res.status(500).json({ error: 'Erro ao cadastrar renegociação.' });
        }
    },

    async listRenegotiations(req, res) {
        try {
            const db = await connectDb();
            const list = await db.all(
                'SELECT * FROM renegotiations WHERE user_id = ? ORDER BY start_date DESC',
                [req.userId]
            );
            return res.json(list);
        } catch (error) {
            console.error('[PersonalController.listRenegotiations]', error);
            return res.status(500).json({ error: 'Erro ao listar renegociacoes.' });
        }
    }
};
