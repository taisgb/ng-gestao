const connectDb = require('../config/database');
const { isDate, isNonEmptyString, isNonNegativeMoney, toMoney } = require('../utils/validators');

const TYPES = ['income', 'expense'];
const STATUSES = ['expected', 'paid', 'overdue', 'canceled'];
const SOURCES = ['manual', 'project', 'project_distribution', 'reimbursement', 'renegotiation', 'recurring'];

function normalizeBoolean(value) {
    return value === true || value === 1 || value === '1' ? 1 : 0;
}

function normalizeSource(body = {}) {
    return body.source || body.origin_type || 'manual';
}

function normalizeOriginLabel(source, value) {
    if (source !== 'manual') return null;
    const label = String(value || '').trim();
    return label || null;
}

function serializeTransaction(row) {
    if (!row) return row;
    return {
        ...row,
        origin_type: row.source
    };
}

function currentYearMonth(query = {}) {
    const today = new Date();
    const month = String(query.month || today.getMonth() + 1).padStart(2, '0');
    const year = String(query.year || today.getFullYear());
    return { month, year };
}

async function ensurePersonalStatus(db, userId) {
    await db.run(`
        INSERT OR IGNORE INTO personal_status (user_id, total_bank_balance, total_debt, credit_card_bill)
        VALUES (?, 0, 0, 0)
    `, [userId]);
}

async function findOwnTransaction(db, id, userId) {
    return db.get(
        'SELECT * FROM personal_transactions WHERE id = ? AND user_id = ? AND archived = 0',
        [id, userId]
    );
}

function validatePayload(body, partial = false) {
    const errors = [];

    if (!partial || body.type !== undefined) {
        if (!TYPES.includes(body.type)) errors.push('Tipo invalido.');
    }

    if (!partial || body.description !== undefined) {
        if (!isNonEmptyString(body.description, 180)) errors.push('Descricao obrigatoria.');
    }

    if (!partial || body.category !== undefined) {
        if (!isNonEmptyString(body.category, 100)) errors.push('Categoria obrigatoria.');
    }

    if (!partial || body.amount !== undefined) {
        if (!isNonNegativeMoney(body.amount) || toMoney(body.amount) === 0) errors.push('Valor positivo e obrigatorio.');
    }

    if (!partial || body.date !== undefined) {
        if (!isDate(body.date)) errors.push('Data invalida.');
    }

    if (body.status !== undefined && !STATUSES.includes(body.status)) errors.push('Status invalido.');

    const hasSource = body.source !== undefined || body.origin_type !== undefined;
    if (hasSource && !SOURCES.includes(normalizeSource(body))) errors.push('Origem invalida.');

    return errors;
}

async function syncFromProjectFinancialEntry(db, entry) {
    if (!entry || !entry.affects_my_financial) return null;

    let type = null;
    let source = 'project';
    if (['expense', 'operational_cost', 'transfer'].includes(entry.type)) type = 'expense';
    if (['income', 'received_payment', 'scope_adjustment', 'scope_increase'].includes(entry.type)) type = 'income';
    if (entry.type === 'reimbursement') {
        type = 'income';
        source = 'reimbursement';
    }

    if (!type) return null;

    const shouldSync =
        (type === 'expense' && entry.status === 'paid') ||
        (type === 'income' && ['paid', 'reimbursed'].includes(entry.status));

    if (!shouldSync) return null;

    const existing = await db.get(
        'SELECT id FROM personal_transactions WHERE project_financial_entry_id = ? AND user_id = ?',
        [entry.id, entry.user_id]
    );

    if (existing) return existing;

    const result = await db.run(`
        INSERT INTO personal_transactions (
            user_id, type, description, category, amount, date, status, payment_method, source, origin_label,
            project_id, team_id, project_financial_entry_id, notes, is_recurring, archived, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP)
    `, [
        entry.user_id,
        type,
        entry.description,
        entry.category || 'Projeto',
        toMoney(entry.amount),
        entry.date,
        entry.payment_method || null,
        source,
        null,
        entry.project_id || null,
        entry.team_id || null,
        entry.id,
        entry.notes || null
    ]);

    return { id: result.lastID };
}

module.exports = {
    TYPES,
    STATUSES,
    SOURCES,
    _syncFromProjectFinancialEntry: syncFromProjectFinancialEntry,

    async index(req, res) {
        try {
            const { type, status, category, month, year, source } = req.query;
            const db = await connectDb();

            let query = 'SELECT * FROM personal_transactions WHERE user_id = ? AND archived = 0';
            const params = [req.userId];

            if (type) {
                query += ' AND type = ?';
                params.push(type);
            }
            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            if (category) {
                query += ' AND category = ?';
                params.push(category);
            }
            if (source) {
                query += ' AND source = ?';
                params.push(source);
            }
            if (month && year) {
                query += " AND strftime('%m', date) = ? AND strftime('%Y', date) = ?";
                params.push(String(month).padStart(2, '0'), String(year));
            }

            query += ' ORDER BY date DESC, id DESC';

            const transactions = await db.all(query, params);
            return res.json(transactions.map(serializeTransaction));
        } catch (error) {
            console.error('[PersonalTransactionController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar lancamentos pessoais.' });
        }
    },

    async create(req, res) {
        try {
            const errors = validatePayload(req.body);
            if (errors.length > 0) return res.status(400).json({ error: errors[0] });

            const db = await connectDb();
            const source = normalizeSource(req.body);
            const originLabel = normalizeOriginLabel(source, req.body.origin_label);
            const result = await db.run(`
                INSERT INTO personal_transactions (
                    user_id, type, description, category, amount, date, status, payment_method,
                    source, origin_label, project_id, team_id, notes, is_recurring, archived, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
            `, [
                req.userId,
                req.body.type,
                req.body.description.trim(),
                req.body.category.trim(),
                toMoney(req.body.amount),
                req.body.date,
                req.body.status || 'expected',
                req.body.payment_method || null,
                source,
                originLabel,
                req.body.project_id || null,
                req.body.team_id || null,
                req.body.notes || null,
                normalizeBoolean(req.body.is_recurring)
            ]);

            return res.status(201).json({ id: result.lastID, message: 'Lancamento pessoal criado.' });
        } catch (error) {
            console.error('[PersonalTransactionController.create]', error);
            return res.status(500).json({ error: 'Erro ao criar lancamento pessoal.' });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const transaction = await findOwnTransaction(db, id, req.userId);
            if (!transaction) return res.status(404).json({ error: 'Lancamento nao encontrado.' });

            const errors = validatePayload(req.body, true);
            if (errors.length > 0) return res.status(400).json({ error: errors[0] });

            const nextSource = req.body.source !== undefined || req.body.origin_type !== undefined
                ? normalizeSource(req.body)
                : transaction.source || 'manual';
            const nextOriginLabel = req.body.origin_label !== undefined || nextSource !== transaction.source
                ? normalizeOriginLabel(nextSource, req.body.origin_label)
                : transaction.origin_label || null;

            await db.run(`
                UPDATE personal_transactions
                SET type = ?,
                    description = ?,
                    category = ?,
                    amount = ?,
                    date = ?,
                    status = ?,
                    payment_method = ?,
                    source = ?,
                    origin_label = ?,
                    notes = ?,
                    is_recurring = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
            `, [
                req.body.type ?? transaction.type,
                req.body.description === undefined ? transaction.description : req.body.description.trim(),
                req.body.category === undefined ? transaction.category : req.body.category.trim(),
                req.body.amount === undefined ? transaction.amount : toMoney(req.body.amount),
                req.body.date === undefined ? transaction.date : req.body.date,
                req.body.status === undefined ? transaction.status : req.body.status,
                req.body.payment_method === undefined ? transaction.payment_method : req.body.payment_method || null,
                nextSource,
                nextOriginLabel,
                req.body.notes === undefined ? transaction.notes : req.body.notes || null,
                req.body.is_recurring === undefined ? transaction.is_recurring : normalizeBoolean(req.body.is_recurring),
                id,
                req.userId
            ]);

            return res.json({ message: 'Lancamento pessoal atualizado.' });
        } catch (error) {
            console.error('[PersonalTransactionController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar lancamento pessoal.' });
        }
    },

    async updateStatus(req, res) {
        try {
            const { id } = req.params;
            const { status } = req.body;
            if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Status invalido.' });

            const db = await connectDb();
            const transaction = await findOwnTransaction(db, id, req.userId);
            if (!transaction) return res.status(404).json({ error: 'Lancamento nao encontrado.' });

            await db.run(
                'UPDATE personal_transactions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
                [status, id, req.userId]
            );

            return res.json({ message: 'Status atualizado.' });
        } catch (error) {
            console.error('[PersonalTransactionController.updateStatus]', error);
            return res.status(500).json({ error: 'Erro ao atualizar status.' });
        }
    },

    async destroy(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const transaction = await findOwnTransaction(db, id, req.userId);
            if (!transaction) return res.status(404).json({ error: 'Lancamento nao encontrado.' });

            await db.run(
                'UPDATE personal_transactions SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
                [id, req.userId]
            );

            return res.json({ message: 'Lancamento arquivado.' });
        } catch (error) {
            console.error('[PersonalTransactionController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao arquivar lancamento.' });
        }
    },

    async summary(req, res) {
        try {
            const db = await connectDb();
            await ensurePersonalStatus(db, req.userId);
            const { month, year } = currentYearMonth(req.query);

            const status = await db.get('SELECT * FROM personal_status WHERE user_id = ?', [req.userId]);
            const fixed = await db.get(
                'SELECT SUM(installment_value) as total FROM renegotiations WHERE active = 1 AND user_id = ?',
                [req.userId]
            );
            const totals = await db.get(`
                SELECT
                    SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
                    SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense
                FROM personal_transactions
                WHERE user_id = ?
                  AND archived = 0
                  AND status != 'canceled'
                  AND strftime('%m', date) = ?
                  AND strftime('%Y', date) = ?
            `, [req.userId, month, year]);

            const bankBalance = Number(status.total_bank_balance || 0);
            const income = Number(totals.income || 0);
            const expense = Number(totals.expense || 0);

            return res.json({
                bank_balance: bankBalance,
                total_income_month: income,
                total_expense_month: expense,
                projected_balance: bankBalance + income - expense,
                total_debt: Number(status.total_debt || 0),
                current_card_bill: Number(status.credit_card_bill || 0),
                fixed_installments: Number(fixed.total || 0),
                month,
                year
            });
        } catch (error) {
            console.error('[PersonalTransactionController.summary]', error);
            return res.status(500).json({ error: 'Erro ao carregar resumo pessoal.' });
        }
    }
};
