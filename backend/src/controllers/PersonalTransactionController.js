const connectDb = require('../config/database');
const { isDate, isNonEmptyString, isNonNegativeMoney, toMoney } = require('../utils/validators');
const { monthYearFilter } = require('../utils/dateSql');

const TYPES = ['income', 'expense'];
const STATUSES = ['expected', 'paid', 'overdue', 'canceled'];
const SOURCES = ['manual', 'project', 'project_distribution', 'reimbursement', 'renegotiation', 'recurring'];
const FINANCIAL_SCOPES = ['personal', 'work', 'project'];
const RECURRENCE_FREQUENCIES = ['monthly', 'weekly', 'yearly'];
const VISIBILITIES = ['private', 'shared_with_owner', 'shared_with_financial_manager', 'shared_with_project'];

function normalizeBoolean(value) {
    return value === true || value === 1 || value === '1' ? 1 : 0;
}

function normalizeSource(body = {}) {
    return body.source || body.origin_type || 'manual';
}

function normalizeOriginLabel(source, value) {
    if (!['manual', 'project_distribution'].includes(source)) return null;
    const label = String(value || '').trim();
    return label || null;
}

function normalizeFinancialScope(body = {}) {
    if (body.financial_type === 'personal_expense') return 'personal';
    if (body.project_id || body.source === 'project') return 'project';
    if (FINANCIAL_SCOPES.includes(body.financial_scope)) return body.financial_scope;
    return 'personal';
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

function emptySummary({ month, year } = {}) {
    return {
        saldo_bancos: 0,
        faturamento_total: 0,
        previsto_mes: 0,
        recebido: 0,
        despesas_pessoais: 0,
        despesas_trabalho: 0,
        repasses: 0,
        minha_parte: 0,
        saldo_previsto: 0,
        saldo_pessoal_previsto: 0,
        recorrentes: 0,
        divida_total: 0,
        fatura_atual: 0,
        parcelas_fixas: 0,
        bank_balance: 0,
        total_income_month: 0,
        total_expense_month: 0,
        personal_expenses: 0,
        personal_expenses_month: 0,
        work_expenses: 0,
        recurring_expenses: 0,
        card_expenses: 0,
        personal_projected_balance: 0,
        gross_revenue_total: 0,
        gross_revenue_period: 0,
        work_gross_revenue: 0,
        expected_month: 0,
        received: 0,
        expected_to_receive: 0,
        transfers: 0,
        own_amount: 0,
        work_own_amount: 0,
        work_operational_expenses: 0,
        projected_balance: 0,
        total_debt: 0,
        current_card_bill: 0,
        fixed_installments: 0,
        month,
        year
    };
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

function normalizeVisibility(value) {
    return VISIBILITIES.includes(value) ? value : 'private';
}

async function syncProjectMemberFinancialEntry(db, transaction) {
    if (!transaction?.id) return;

    if (!transaction.project_id || transaction.financial_scope === 'personal' || transaction.archived === 1) {
        await db.run(
            'UPDATE project_member_financial_entries SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE personal_transaction_id = ?',
            [transaction.id]
        );
        return;
    }

    const visibility = normalizeVisibility(transaction.visibility);
    const sharedWithProjectOwner = visibility === 'shared_with_owner' || transaction.shared_with_project_owner === 1 ? 1 : 0;

    await db.run(`
        INSERT INTO project_member_financial_entries (
            project_id, user_id, created_by, personal_transaction_id, financial_type,
            gross_amount, own_amount, transfer_amount, payment_due_date, paid_at,
            status, visibility, shared_with_project_owner, archived, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(personal_transaction_id) DO UPDATE SET
            project_id = excluded.project_id,
            user_id = excluded.user_id,
            financial_type = excluded.financial_type,
            gross_amount = excluded.gross_amount,
            own_amount = excluded.own_amount,
            transfer_amount = excluded.transfer_amount,
            payment_due_date = excluded.payment_due_date,
            paid_at = excluded.paid_at,
            status = excluded.status,
            visibility = excluded.visibility,
            shared_with_project_owner = excluded.shared_with_project_owner,
            archived = 0,
            updated_at = CURRENT_TIMESTAMP
    `, [
        transaction.project_id,
        transaction.user_id,
        transaction.user_id,
        transaction.id,
        transaction.financial_type || transaction.type,
        Number(transaction.gross_amount ?? transaction.amount ?? 0),
        transaction.own_amount,
        transaction.transfer_amount,
        transaction.payment_due_date || null,
        transaction.paid_at || null,
        transaction.status || 'expected',
        visibility,
        sharedWithProjectOwner
    ]);
}

function validatePayload(body, partial = false) {
    const errors = [];

    if (!partial || body.type !== undefined) {
        if (!TYPES.includes(body.type)) errors.push('Tipo inválido.');
    }

    if (!partial || body.description !== undefined) {
        if (!isNonEmptyString(body.description, 180)) errors.push('Descrição obrigatória.');
    }

    if (!partial || body.category !== undefined) {
        if (!isNonEmptyString(body.category, 100)) errors.push('Categoria obrigatória.');
    }

    if (!partial || body.amount !== undefined) {
        if (!isNonNegativeMoney(body.amount) || toMoney(body.amount) === 0) errors.push('Valor positivo e obrigatório.');
    }

    if (!partial || body.date !== undefined) {
        if (!isDate(body.date)) errors.push('Data inválida.');
    }

    if (body.payment_due_date !== undefined && body.payment_due_date && !isDate(body.payment_due_date)) {
        errors.push('Data prevista inválida.');
    }

    if (body.paid_at !== undefined && body.paid_at && !isDate(body.paid_at)) {
        errors.push('Data de pagamento inválida.');
    }

    ['gross_amount', 'own_amount', 'transfer_amount'].forEach(field => {
        if (body[field] !== undefined && body[field] !== null && body[field] !== '' && !isNonNegativeMoney(body[field])) {
            errors.push('Valor inválido.');
        }
    });

    if (body.status !== undefined && !STATUSES.includes(body.status)) errors.push('Status inválido.');

    const hasSource = body.source !== undefined || body.origin_type !== undefined;
    if (hasSource && !SOURCES.includes(normalizeSource(body))) errors.push('Origem inválida.');

    if (body.financial_scope !== undefined && !FINANCIAL_SCOPES.includes(body.financial_scope)) {
        errors.push('Escopo financeiro inválido.');
    }

    if (body.recurrence_frequency !== undefined && body.recurrence_frequency && !RECURRENCE_FREQUENCIES.includes(body.recurrence_frequency)) {
        errors.push('Frequência de recorrência inválida.');
    }

    return errors;
}

async function syncFromProjectFinancialEntry(db, entry) {
    if (!entry || (!entry.affects_my_financial && !entry.affects_personal_finance)) return null;

    let type = null;
    let source = 'project';
    const financialType = entry.financial_type || entry.type;
    if (['operational_expense', 'expense', 'operational_cost', 'transfer'].includes(financialType)) type = 'expense';
    if (['revenue', 'payment_received', 'income', 'received_payment', 'scope_adjustment', 'scope_increase', 'adjustment_positive'].includes(financialType)) type = 'income';
    if (financialType === 'reimbursement') {
        type = 'income';
    }

    if (!type) return null;

    const shouldSync =
        (type === 'expense' && entry.status === 'paid') ||
        (type === 'income' && ['paid', 'reimbursed'].includes(entry.status));

    if (!shouldSync) {
        const existingToCancel = await db.get(
            'SELECT id FROM personal_transactions WHERE project_financial_entry_id = ? AND user_id = ?',
            [entry.id, entry.user_id]
        );
        if (existingToCancel) {
            await db.run(
                "UPDATE personal_transactions SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [existingToCancel.id]
            );
        }
        return null;
    }

    const existing = await db.get(
        'SELECT id FROM personal_transactions WHERE project_financial_entry_id = ? AND user_id = ?',
        [entry.id, entry.user_id]
    );

    const grossAmount = toMoney(entry.gross_amount ?? entry.amount);
    const ownAmount = entry.own_amount !== undefined && entry.own_amount !== null
        ? toMoney(entry.own_amount)
        : (type === 'income'
            ? Math.max(0, grossAmount - Number(entry.transfer_amount || 0))
            : grossAmount);
    const transferAmount = entry.transfer_amount !== undefined && entry.transfer_amount !== null
        ? toMoney(entry.transfer_amount)
        : (financialType === 'transfer' ? grossAmount : 0);
    const personalAmount = type === 'income' ? ownAmount : (financialType === 'transfer' ? transferAmount : grossAmount);
    const status = entry.status === 'paid' || entry.status === 'reimbursed' ? 'paid' : 'expected';
    const date = entry.paid_at || entry.payment_due_date || entry.date;

    if (existing) {
        await db.run(`
            UPDATE personal_transactions
            SET type = ?,
                description = ?,
                category = ?,
                amount = ?,
                gross_amount = ?,
                own_amount = ?,
                transfer_amount = ?,
                date = ?,
                payment_due_date = ?,
                paid_at = ?,
                status = ?,
                payment_method = ?,
                source = ?,
                financial_type = ?,
                financial_scope = ?,
                project_id = ?,
                team_id = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [
            type,
            entry.description,
            entry.category || 'Projeto',
            personalAmount,
            grossAmount,
            ownAmount,
            transferAmount,
            date,
            entry.payment_due_date || null,
            entry.paid_at || null,
            status,
            entry.payment_method || null,
            source,
            financialType,
            'project',
            entry.project_id || null,
            entry.team_id || null,
            entry.notes || null,
            existing.id
        ]);
        return existing;
    }

    const result = await db.run(`
        INSERT INTO personal_transactions (
            user_id, type, description, category, amount, gross_amount, own_amount, transfer_amount,
            date, payment_due_date, paid_at, status, payment_method, source, origin_label, financial_type,
            financial_scope, project_id, team_id, project_financial_entry_id, notes, is_recurring, archived, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP)
    `, [
        entry.user_id,
        type,
        entry.description,
        entry.category || 'Projeto',
        personalAmount,
        grossAmount,
        ownAmount,
        transferAmount,
        date,
        entry.payment_due_date || null,
        entry.paid_at || null,
        status,
        entry.payment_method || null,
        source,
        null,
        financialType,
        'project',
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
            const { type, status, category, month, year, source, project_id, from, to, financial_scope, financial_type, is_recurring } = req.query;
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
            if (project_id) {
                query += ' AND project_id = ?';
                params.push(project_id);
            }
            if (financial_scope) {
                query += ' AND financial_scope = ?';
                params.push(financial_scope);
            }
            if (financial_type) {
                query += ' AND financial_type = ?';
                params.push(financial_type);
            }
            if (is_recurring) {
                query += ' AND is_recurring = ?';
                params.push(normalizeBoolean(is_recurring));
            }
            if (month && year) {
                query += ` AND ${monthYearFilter(db, 'COALESCE(payment_due_date, date)')}`;
                params.push(String(month).padStart(2, '0'), String(year));
            }
            if (from) {
                query += ' AND COALESCE(payment_due_date, date) >= ?';
                params.push(from);
            }
            if (to) {
                query += ' AND COALESCE(payment_due_date, date) <= ?';
                params.push(to);
            }

            query += ' ORDER BY date DESC, id DESC';

            const transactions = await db.all(query, params);
            return res.json(transactions.map(serializeTransaction));
        } catch (error) {
            console.error('[PersonalTransactionController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar lançamentos pessoais.' });
        }
    },

    async create(req, res) {
        try {
            const errors = validatePayload(req.body);
            if (errors.length > 0) return res.status(400).json({ error: errors[0] });

            const db = await connectDb();
            const source = normalizeSource(req.body);
            const originLabel = normalizeOriginLabel(source, req.body.origin_label);
            const financialType = req.body.financial_type || (req.body.type === 'expense' ? 'personal_expense' : null);
            const financialScope = normalizeFinancialScope({
                ...req.body,
                source,
                financial_type: financialType
            });
            const grossAmount = req.body.gross_amount === undefined || req.body.gross_amount === null || req.body.gross_amount === ''
                ? toMoney(req.body.amount)
                : toMoney(req.body.gross_amount);
            const visibility = normalizeVisibility(req.body.visibility);
            const result = await db.run(`
                INSERT INTO personal_transactions (
                    user_id, type, description, category, amount, gross_amount, own_amount, transfer_amount,
                    date, payment_due_date, paid_at, status, payment_method, source, origin_label,
                    visibility, shared_with_project_owner, financial_type, financial_scope, recurrence_frequency,
                    project_id, team_id, notes, is_recurring, archived, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
            `, [
                req.userId,
                req.body.type,
                req.body.description.trim(),
                req.body.category.trim(),
                toMoney(req.body.amount),
                grossAmount,
                req.body.own_amount === undefined || req.body.own_amount === null || req.body.own_amount === '' ? null : toMoney(req.body.own_amount),
                req.body.transfer_amount === undefined || req.body.transfer_amount === null || req.body.transfer_amount === '' ? null : toMoney(req.body.transfer_amount),
                req.body.date,
                req.body.payment_due_date || null,
                req.body.paid_at || null,
                req.body.status || 'expected',
                req.body.payment_method || null,
                source,
                originLabel,
                visibility,
                visibility === 'shared_with_owner' || normalizeBoolean(req.body.shared_with_project_owner) ? 1 : 0,
                financialType,
                financialScope,
                req.body.recurrence_frequency || null,
                financialScope === 'personal' ? null : req.body.project_id || null,
                req.body.team_id || null,
                req.body.notes || null,
                normalizeBoolean(req.body.is_recurring)
            ]);

            const created = await db.get('SELECT * FROM personal_transactions WHERE id = ?', [result.lastID]);
            await syncProjectMemberFinancialEntry(db, created);

            return res.status(201).json({ id: result.lastID, message: 'Lançamento pessoal criado.' });
        } catch (error) {
            console.error('[PersonalTransactionController.create]', error);
            return res.status(500).json({ error: 'Erro ao criar lançamento pessoal.' });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const transaction = await findOwnTransaction(db, id, req.userId);
            if (!transaction) return res.status(404).json({ error: 'Lançamento não encontrado.' });

            const errors = validatePayload(req.body, true);
            if (errors.length > 0) return res.status(400).json({ error: errors[0] });

            const nextSource = req.body.source !== undefined || req.body.origin_type !== undefined
                ? normalizeSource(req.body)
                : transaction.source || 'manual';
            const nextOriginLabel = req.body.origin_label !== undefined || nextSource !== transaction.source
                ? normalizeOriginLabel(nextSource, req.body.origin_label)
                : transaction.origin_label || null;
            const nextFinancialType = req.body.financial_type === undefined
                ? transaction.financial_type
                : req.body.financial_type || null;
            const nextFinancialScope = req.body.financial_scope !== undefined || req.body.financial_type !== undefined || req.body.project_id !== undefined || nextSource !== transaction.source
                ? normalizeFinancialScope({
                    ...transaction,
                    ...req.body,
                    source: nextSource,
                    financial_type: nextFinancialType
                })
                : transaction.financial_scope || 'personal';

            await db.run(`
                UPDATE personal_transactions
                SET type = ?,
                    description = ?,
                    category = ?,
                    amount = ?,
                    gross_amount = ?,
                    own_amount = ?,
                    transfer_amount = ?,
                    date = ?,
                    payment_due_date = ?,
                    paid_at = ?,
                    status = ?,
                    payment_method = ?,
                    source = ?,
                    origin_label = ?,
                    visibility = ?,
                    shared_with_project_owner = ?,
                    financial_type = ?,
                    financial_scope = ?,
                    recurrence_frequency = ?,
                    project_id = ?,
                    team_id = ?,
                    notes = ?,
                    is_recurring = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
            `, [
                req.body.type ?? transaction.type,
                req.body.description === undefined ? transaction.description : req.body.description.trim(),
                req.body.category === undefined ? transaction.category : req.body.category.trim(),
                req.body.amount === undefined ? transaction.amount : toMoney(req.body.amount),
                req.body.gross_amount === undefined ? transaction.gross_amount : req.body.gross_amount === null || req.body.gross_amount === '' ? null : toMoney(req.body.gross_amount),
                req.body.own_amount === undefined ? transaction.own_amount : req.body.own_amount === null || req.body.own_amount === '' ? null : toMoney(req.body.own_amount),
                req.body.transfer_amount === undefined ? transaction.transfer_amount : req.body.transfer_amount === null || req.body.transfer_amount === '' ? null : toMoney(req.body.transfer_amount),
                req.body.date === undefined ? transaction.date : req.body.date,
                req.body.payment_due_date === undefined ? transaction.payment_due_date : req.body.payment_due_date || null,
                req.body.paid_at === undefined ? transaction.paid_at : req.body.paid_at || null,
                req.body.status === undefined ? transaction.status : req.body.status,
                req.body.payment_method === undefined ? transaction.payment_method : req.body.payment_method || null,
                nextSource,
                nextOriginLabel,
                req.body.visibility === undefined ? transaction.visibility || 'private' : normalizeVisibility(req.body.visibility),
                req.body.shared_with_project_owner === undefined
                    ? transaction.shared_with_project_owner || 0
                    : (normalizeVisibility(req.body.visibility) === 'shared_with_owner' || normalizeBoolean(req.body.shared_with_project_owner) ? 1 : 0),
                nextFinancialType,
                nextFinancialScope,
                req.body.recurrence_frequency === undefined ? transaction.recurrence_frequency : req.body.recurrence_frequency || null,
                nextFinancialScope === 'personal' ? null : (req.body.project_id === undefined ? transaction.project_id : req.body.project_id || null),
                req.body.team_id === undefined ? transaction.team_id : req.body.team_id || null,
                req.body.notes === undefined ? transaction.notes : req.body.notes || null,
                req.body.is_recurring === undefined ? transaction.is_recurring : normalizeBoolean(req.body.is_recurring),
                id,
                req.userId
            ]);

            const updated = await db.get('SELECT * FROM personal_transactions WHERE id = ?', [id]);
            await syncProjectMemberFinancialEntry(db, updated);

            return res.json({ message: 'Lançamento pessoal atualizado.' });
        } catch (error) {
            console.error('[PersonalTransactionController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar lançamento pessoal.' });
        }
    },

    async updateStatus(req, res) {
        try {
            const { id } = req.params;
            const { status } = req.body;
            if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Status inválido.' });

            const db = await connectDb();
            const transaction = await findOwnTransaction(db, id, req.userId);
            if (!transaction) return res.status(404).json({ error: 'Lançamento não encontrado.' });

            await db.run(
                'UPDATE personal_transactions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
                [status, id, req.userId]
            );

            const updated = await db.get('SELECT * FROM personal_transactions WHERE id = ?', [id]);
            await syncProjectMemberFinancialEntry(db, updated);

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
            if (!transaction) return res.status(404).json({ error: 'Lançamento não encontrado.' });

            await db.run(
                'UPDATE personal_transactions SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
                [id, req.userId]
            );
            await db.run(
                'UPDATE project_member_financial_entries SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE personal_transaction_id = ?',
                [id]
            );

            return res.json({ message: 'Lançamento arquivado.' });
        } catch (error) {
            console.error('[PersonalTransactionController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao arquivar lançamento.' });
        }
    },

    async summary(req, res) {
        try {
            const db = await connectDb();
            await ensurePersonalStatus(db, req.userId);
            const { month, year } = currentYearMonth(req.query);
            const hasPeriodFilter = Boolean(req.query.month && req.query.year);
            const fallbackSummary = emptySummary({ month, year });

            const status = await db.get('SELECT * FROM personal_status WHERE user_id = ?', [req.userId]);
            const fixed = await db.get(
                'SELECT SUM(installment_value) as total FROM renegotiations WHERE active = 1 AND user_id = ?',
                [req.userId]
            );
            const periodPredicate = hasPeriodFilter
                ? `AND ${monthYearFilter(db, 'date')}`
                : '';

            const totalsParams = [req.userId];
            if (hasPeriodFilter) totalsParams.push(month, year);

            const totals = await db.get(`
                SELECT
                    COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
                    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense,
                    COALESCE(SUM(CASE WHEN type = 'income' THEN COALESCE(gross_amount, amount) ELSE 0 END), 0) as gross_income,
                    COALESCE(SUM(COALESCE(transfer_amount, CASE WHEN financial_type = 'transfer' THEN amount ELSE 0 END)), 0) as transfers,
                    COALESCE(SUM(CASE WHEN type = 'income' THEN COALESCE(own_amount, amount) ELSE 0 END), 0) as own_amount,
                    COALESCE(SUM(CASE WHEN type = 'expense' AND financial_scope = 'personal' THEN amount ELSE 0 END), 0) as personal_expenses,
                    COALESCE(SUM(CASE WHEN type = 'expense' AND financial_scope IN ('work', 'project') AND COALESCE(financial_type, '') != 'transfer' THEN amount ELSE 0 END), 0) as work_expenses,
                    COALESCE(SUM(CASE WHEN type = 'expense' AND is_recurring = 1 THEN amount ELSE 0 END), 0) as recurring_expenses,
                    COALESCE(SUM(CASE WHEN type = 'expense' AND financial_scope = 'personal' AND (LOWER(category) LIKE '%cart%' OR LOWER(COALESCE(payment_method, '')) LIKE '%cart%') THEN amount ELSE 0 END), 0) as card_expenses
                FROM personal_transactions
                WHERE user_id = ?
                  AND archived = 0
                  AND status != 'canceled'
                  ${periodPredicate}
            `, totalsParams);

            const allTotals = await db.get(`
                SELECT
                    COALESCE(SUM(CASE WHEN type = 'income' THEN COALESCE(gross_amount, amount) ELSE 0 END), 0) as gross_income,
                    COALESCE(SUM(COALESCE(transfer_amount, CASE WHEN financial_type = 'transfer' THEN amount ELSE 0 END)), 0) as transfers,
                    COALESCE(SUM(CASE WHEN type = 'income' THEN COALESCE(own_amount, amount) ELSE 0 END), 0) as own_amount,
                    COALESCE(SUM(CASE WHEN type = 'expense' AND financial_scope = 'personal' THEN amount ELSE 0 END), 0) as personal_expenses,
                    COALESCE(SUM(CASE WHEN type = 'expense' AND financial_scope IN ('work', 'project') AND COALESCE(financial_type, '') != 'transfer' THEN amount ELSE 0 END), 0) as work_expenses
                FROM personal_transactions
                WHERE user_id = ?
                  AND archived = 0
                  AND status != 'canceled'
            `, [req.userId]);

            const expected = await db.get(`
                SELECT
                    COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as expected_income,
                    COALESCE(SUM(CASE WHEN type = 'income' AND status = 'paid' THEN amount ELSE 0 END), 0) as received_income,
                    COALESCE(SUM(CASE WHEN type = 'income' AND status != 'paid' THEN amount ELSE 0 END), 0) as pending_income
                FROM personal_transactions
                WHERE user_id = ?
                  AND archived = 0
                  AND status != 'canceled'
                  AND ${monthYearFilter(db, 'COALESCE(payment_due_date, date)')}
            `, [req.userId, month, year]);

            const bankBalance = Number(status.total_bank_balance || 0);
            const income = Number(totals.income || 0);
            const expense = Number(totals.expense || 0);

            return res.json({
                ...fallbackSummary,
                saldo_bancos: bankBalance,
                faturamento_total: Number(allTotals.gross_income || 0),
                previsto_mes: Number(expected.expected_income || 0),
                recebido: Number(expected.received_income || 0),
                despesas_pessoais: Number(totals.personal_expenses || 0),
                despesas_trabalho: Number(totals.work_expenses || 0),
                repasses: Number(totals.transfers || 0),
                minha_parte: Number(totals.own_amount || allTotals.own_amount || 0),
                saldo_previsto: bankBalance + income - expense,
                saldo_pessoal_previsto: bankBalance + income - Number(totals.personal_expenses || 0),
                recorrentes: Number(totals.recurring_expenses || 0),
                divida_total: Number(status.total_debt || 0),
                fatura_atual: Number(status.credit_card_bill || 0),
                parcelas_fixas: Number(fixed.total || 0),
                bank_balance: bankBalance,
                total_income_month: income,
                total_expense_month: expense,
                personal_expenses: Number(totals.personal_expenses || 0),
                personal_expenses_month: Number(totals.personal_expenses || 0),
                work_expenses: Number(totals.work_expenses || 0),
                recurring_expenses: Number(totals.recurring_expenses || 0),
                card_expenses: Number(totals.card_expenses || 0),
                personal_projected_balance: bankBalance + income - Number(totals.personal_expenses || 0),
                gross_revenue_total: Number(allTotals.gross_income || 0),
                gross_revenue_period: Number(totals.gross_income || 0),
                work_gross_revenue: Number(totals.gross_income || 0),
                expected_month: Number(expected.expected_income || 0),
                received: Number(expected.received_income || 0),
                expected_to_receive: Number(expected.pending_income || 0),
                transfers: Number(totals.transfers || 0),
                own_amount: Number(totals.own_amount || allTotals.own_amount || 0),
                work_own_amount: Number(totals.own_amount || allTotals.own_amount || 0),
                work_operational_expenses: Number(totals.work_expenses || 0),
                projected_balance: bankBalance + income - expense,
                total_debt: Number(status.total_debt || 0),
                current_card_bill: Number(status.credit_card_bill || 0),
                fixed_installments: Number(fixed.total || 0),
                month,
                year
            });
        } catch (error) {
            console.error('[PersonalTransactionController.summary]', error);
            const { month, year } = currentYearMonth(req.query);
            return res.json(emptySummary({ month, year }));
        }
    }
};
