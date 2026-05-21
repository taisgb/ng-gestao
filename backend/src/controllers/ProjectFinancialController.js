const connectDb = require('../config/database');
const { isDate, isNonEmptyString, isNonNegativeMoney, toMoney } = require('../utils/validators');
const {
    canEditProjectFinancials,
    canViewOwnFinancialShare,
    canViewProjectFinancials,
    getProjectAccess
} = require('../utils/permissions');
const PersonalTransactionController = require('./PersonalTransactionController');
const { calculateProjectFinancialSummary } = require('../services/projectFinancialSummary');
const { logActivity } = require('../utils/activityLog');

const TYPES = [
    'revenue',
    'payment_received',
    'scope_increase',
    'operational_expense',
    'transfer',
    'reimbursement',
    'adjustment_positive',
    'adjustment_negative',
    'income',
    'expense',
    'received_payment',
    'scope_adjustment',
    'operational_cost'
];
const STATUSES = ['pending', 'expected', 'paid', 'reimbursed', 'canceled', 'archived'];

async function getEntry(db, projectId, entryId) {
    return db.get(
        'SELECT * FROM project_financial_entries WHERE id = ? AND project_id = ? AND archived = 0',
        [entryId, projectId]
    );
}

function normalizeBoolean(value) {
    return value === true || value === 1 || value === '1' ? 1 : 0;
}

function transactionTypeFor(entry) {
    const type = entry.financial_type || entry.type;
    if (['operational_expense', 'expense', 'operational_cost', 'transfer'].includes(type)) return 'Despesa';
    if (['revenue', 'income', 'reimbursement', 'payment_received', 'received_payment', 'scope_adjustment', 'scope_increase', 'adjustment_positive'].includes(type)) return 'Receita';
    return null;
}

async function syncPersonalTransaction(db, entry) {
    await PersonalTransactionController._syncFromProjectFinancialEntry(db, entry);

    if (!entry.affects_my_financial) return;
    const txType = transactionTypeFor(entry);
    if (!txType) return;
    const shouldSync =
        (txType === 'Despesa' && entry.status === 'paid') ||
        (txType === 'Receita' && ['paid', 'reimbursed'].includes(entry.status));

    if (!shouldSync) return;

    const existing = await db.get(
        'SELECT id FROM transactions WHERE project_financial_entry_id = ? AND user_id = ?',
        [entry.id, entry.user_id]
    );

    if (existing) return;

    const grossAmount = toMoney(entry.gross_amount ?? entry.amount);
    const ownAmount = entry.own_amount !== undefined && entry.own_amount !== null
        ? toMoney(entry.own_amount)
        : Math.max(0, grossAmount - Number(entry.transfer_amount || 0));
    const legacyAmount = txType === 'Receita' ? ownAmount : grossAmount;

    await db.run(`
        INSERT INTO transactions (
            user_id, type, entity, category, amount, date, description, project_id, project_financial_entry_id
        )
        VALUES (?, ?, 'MEI', ?, ?, ?, ?, ?, ?)
    `, [
        entry.user_id,
        txType,
        entry.category || 'Projeto',
        legacyAmount,
        entry.paid_at || entry.payment_due_date || entry.date,
        entry.description,
        entry.project_id,
        entry.id
    ]);
}

async function getSummary(db, projectId) {
    return calculateProjectFinancialSummary(db, projectId);
}

module.exports = {
    _calculateSummary: getSummary,

    async index(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            if (!await canViewOwnFinancialShare(db, req.userId, id)) {
                return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });
            }

            const canViewGlobal = await canViewProjectFinancials(db, req.userId, id);
            const entries = await db.all(`
                SELECT pfe.*, u.name as created_by_name
                FROM project_financial_entries pfe
                LEFT JOIN users u ON u.id = pfe.created_by
                WHERE pfe.project_id = ?
                  AND (? = 1 OR pfe.user_id = ? OR pfe.created_by = ?)
                ORDER BY pfe.date DESC, pfe.id DESC
            `, [id, canViewGlobal ? 1 : 0, req.userId, req.userId]);

            return res.json({
                can_view_global: canViewGlobal,
                can_edit_global: await canEditProjectFinancials(db, req.userId, id),
                entries
            });
        } catch (error) {
            console.error('[ProjectFinancialController.index]', error);
            return res.status(500).json({ error: 'Erro ao listar lançamentos do projeto.' });
        }
    },

    async create(req, res) {
        try {
            const { id } = req.params;
            const {
                type,
                financial_type,
                description,
                category,
                amount,
                gross_amount,
                own_amount,
                transfer_amount,
                date,
                payment_due_date,
                paid_at,
                status,
                payment_method,
                affects_project_total,
                affects_personal_finance,
                affects_my_financial,
                reimbursable,
                billable_to_client,
                notes,
                user_id
            } = req.body;
            const db = await connectDb();

            const project = await getProjectAccess(db, req.userId, id);
            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });
            if (!await canEditProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissão para criar lançamentos financeiros neste projeto.' });
            }

            const normalizedType = financial_type || type;
            if (!TYPES.includes(normalizedType) || !isNonEmptyString(description, 180) || !isNonEmptyString(category, 100) || !isDate(date)) {
                return res.status(400).json({ error: 'Tipo, descrição, categoria e data válidos são obrigatórios.' });
            }

            const entryAmount = gross_amount ?? amount;
            if (!isNonNegativeMoney(entryAmount) || toMoney(entryAmount) === 0) {
                return res.status(400).json({ error: 'Valor positivo e obrigatório.' });
            }

            if (payment_due_date && !isDate(payment_due_date)) return res.status(400).json({ error: 'Data prevista inválida.' });
            if (paid_at && !isDate(paid_at)) return res.status(400).json({ error: 'Data de pagamento inválida.' });

            if (status && !STATUSES.includes(status)) {
                return res.status(400).json({ error: 'Status inválido.' });
            }

            const ownerUserId = user_id || req.userId;
            const result = await db.run(`
                INSERT INTO project_financial_entries (
                    project_id, team_id, user_id, created_by, type, financial_type, description, category,
                    amount, gross_amount, own_amount, transfer_amount, date, payment_due_date, paid_at, status,
                    payment_method, affects_project_total, affects_personal_finance, affects_my_financial,
                    reimbursable, billable_to_client, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                id,
                project.team_id || project.client_team_id || null,
                ownerUserId,
                req.userId,
                normalizedType,
                normalizedType,
                description.trim(),
                category.trim(),
                toMoney(entryAmount),
                toMoney(entryAmount),
                own_amount === undefined || own_amount === null || own_amount === '' ? null : toMoney(own_amount),
                transfer_amount === undefined || transfer_amount === null || transfer_amount === '' ? null : toMoney(transfer_amount),
                date,
                payment_due_date || null,
                paid_at || null,
                status || 'pending',
                payment_method || null,
                affects_project_total === undefined ? 1 : normalizeBoolean(affects_project_total),
                normalizeBoolean(affects_personal_finance),
                normalizeBoolean(affects_my_financial),
                normalizeBoolean(reimbursable),
                normalizeBoolean(billable_to_client),
                notes || null
            ]);

            const entry = await db.get('SELECT * FROM project_financial_entries WHERE id = ?', [result.lastID]);
            await syncPersonalTransaction(db, entry);

            await logActivity(db, req.userId, 'create_financial_entry', 'project', id, { entry_id: result.lastID, type });
            return res.status(201).json({ id: result.lastID, message: 'Lançamento do projeto criado.' });
        } catch (error) {
            console.error('[ProjectFinancialController.create]', error);
            return res.status(500).json({ error: 'Erro ao criar lançamento financeiro do projeto.' });
        }
    },

    async update(req, res) {
        try {
            const { id, entryId } = req.params;
            const db = await connectDb();

            if (!await canEditProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissão para editar lançamentos financeiros.' });
            }

            const entry = await getEntry(db, id, entryId);
            if (!entry) return res.status(404).json({ error: 'Lançamento não encontrado.' });

            const {
                type,
                financial_type,
                description,
                category,
                amount,
                gross_amount,
                own_amount,
                transfer_amount,
                date,
                payment_due_date,
                paid_at,
                status,
                payment_method,
                affects_project_total,
                affects_personal_finance,
                affects_my_financial,
                reimbursable,
                billable_to_client,
                reimbursed_at,
                notes
            } = req.body;

            const normalizedType = financial_type || type;
            if (normalizedType !== undefined && !TYPES.includes(normalizedType)) return res.status(400).json({ error: 'Tipo inválido.' });
            if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
            if (description !== undefined && !isNonEmptyString(description, 180)) return res.status(400).json({ error: 'Descrição inválida.' });
            if (category !== undefined && !isNonEmptyString(category, 100)) return res.status(400).json({ error: 'Categoria inválida.' });
            if (date !== undefined && !isDate(date)) return res.status(400).json({ error: 'Data inválida.' });
            const entryAmount = gross_amount ?? amount;
            if (entryAmount !== undefined && (!isNonNegativeMoney(entryAmount) || toMoney(entryAmount) === 0)) return res.status(400).json({ error: 'Valor inválido.' });
            if (payment_due_date !== undefined && payment_due_date && !isDate(payment_due_date)) return res.status(400).json({ error: 'Data prevista inválida.' });
            if (paid_at !== undefined && paid_at && !isDate(paid_at)) return res.status(400).json({ error: 'Data de pagamento inválida.' });

            await db.run(`
                UPDATE project_financial_entries
                SET type = COALESCE(?, type),
                    financial_type = COALESCE(?, financial_type),
                    description = COALESCE(?, description),
                    category = COALESCE(?, category),
                    amount = COALESCE(?, amount),
                    gross_amount = COALESCE(?, gross_amount),
                    own_amount = ?,
                    transfer_amount = ?,
                    date = COALESCE(?, date),
                    payment_due_date = ?,
                    paid_at = ?,
                    status = COALESCE(?, status),
                    payment_method = COALESCE(?, payment_method),
                    affects_project_total = COALESCE(?, affects_project_total),
                    affects_personal_finance = COALESCE(?, affects_personal_finance),
                    affects_my_financial = COALESCE(?, affects_my_financial),
                    reimbursable = COALESCE(?, reimbursable),
                    billable_to_client = COALESCE(?, billable_to_client),
                    reimbursed_at = COALESCE(?, reimbursed_at),
                    notes = COALESCE(?, notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND project_id = ?
            `, [
                normalizedType,
                normalizedType,
                description === undefined ? null : description.trim(),
                category === undefined ? null : category.trim(),
                entryAmount === undefined ? null : toMoney(entryAmount),
                entryAmount === undefined ? null : toMoney(entryAmount),
                own_amount === undefined ? entry.own_amount : own_amount === null || own_amount === '' ? null : toMoney(own_amount),
                transfer_amount === undefined ? entry.transfer_amount : transfer_amount === null || transfer_amount === '' ? null : toMoney(transfer_amount),
                date,
                payment_due_date === undefined ? entry.payment_due_date : payment_due_date || null,
                paid_at === undefined ? entry.paid_at : paid_at || null,
                status,
                payment_method,
                affects_project_total === undefined ? null : normalizeBoolean(affects_project_total),
                affects_personal_finance === undefined ? null : normalizeBoolean(affects_personal_finance),
                affects_my_financial === undefined ? null : normalizeBoolean(affects_my_financial),
                reimbursable === undefined ? null : normalizeBoolean(reimbursable),
                billable_to_client === undefined ? null : normalizeBoolean(billable_to_client),
                reimbursed_at,
                notes,
                entryId,
                id
            ]);

            const updated = await getEntry(db, id, entryId);
            await syncPersonalTransaction(db, updated);

            await logActivity(db, req.userId, 'update_financial_entry', 'project', id, { entry_id: entryId });
            return res.json({ message: 'Lançamento atualizado.' });
        } catch (error) {
            console.error('[ProjectFinancialController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar lançamento financeiro.' });
        }
    },

    async updateStatus(req, res) {
        try {
            const { id, entryId } = req.params;
            const { status } = req.body;
            const db = await connectDb();

            if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
            if (!await canEditProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissão para alterar status financeiro.' });
            }

            const entry = await getEntry(db, id, entryId);
            if (!entry) return res.status(404).json({ error: 'Lançamento não encontrado.' });

            await db.run(`
                UPDATE project_financial_entries
                SET status = ?,
                    archived = CASE WHEN ? = 'archived' THEN 1 ELSE archived END,
                    paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, DATE('now')) ELSE paid_at END,
                    reimbursed_at = CASE WHEN ? = 'reimbursed' THEN COALESCE(reimbursed_at, DATE('now')) ELSE reimbursed_at END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND project_id = ?
            `, [status, status, status, status, entryId, id]);

            const updated = await getEntry(db, id, entryId);
            await syncPersonalTransaction(db, updated);

            await logActivity(db, req.userId, 'update_financial_status', 'project', id, { entry_id: entryId, status });
            return res.json({ message: 'Status atualizado.' });
        } catch (error) {
            console.error('[ProjectFinancialController.updateStatus]', error);
            return res.status(500).json({ error: 'Erro ao atualizar status do lançamento.' });
        }
    },

    async destroy(req, res) {
        try {
            const { id, entryId } = req.params;
            const db = await connectDb();

            if (!await canEditProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissão para arquivar lançamentos financeiros.' });
            }

            const result = await db.run(`
                UPDATE project_financial_entries
                SET archived = 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND project_id = ?
            `, [entryId, id]);

            if (result.changes === 0) return res.status(404).json({ error: 'Lançamento não encontrado.' });
            await logActivity(db, req.userId, 'archive_financial_entry', 'project', id, { entry_id: entryId });
            return res.json({ message: 'Lançamento arquivado.' });
        } catch (error) {
            console.error('[ProjectFinancialController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao arquivar lançamento.' });
        }
    },

    async restore(req, res) {
        try {
            const { id, entryId } = req.params;
            const db = await connectDb();

            if (!await canEditProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissão para restaurar lançamentos financeiros.' });
            }

            const result = await db.run(`
                UPDATE project_financial_entries
                SET archived = 0, status = 'pending', updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND project_id = ?
            `, [entryId, id]);

            if (result.changes === 0) return res.status(404).json({ error: 'Lançamento não encontrado.' });
            await logActivity(db, req.userId, 'restore_financial_entry', 'project', id, { entry_id: entryId });
            return res.json({ message: 'Lançamento restaurado.' });
        } catch (error) {
            console.error('[ProjectFinancialController.restore]', error);
            return res.status(500).json({ error: 'Erro ao restaurar lançamento.' });
        }
    },

    async summary(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            if (!await canViewProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissão para visualizar resumo financeiro global.' });
            }

            return res.json(await getSummary(db, id));
        } catch (error) {
            console.error('[ProjectFinancialController.summary]', error);
            return res.status(500).json({ error: 'Erro ao carregar resumo financeiro do projeto.' });
        }
    }
};
