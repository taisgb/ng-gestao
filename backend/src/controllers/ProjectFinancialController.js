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

const TYPES = ['income', 'expense', 'reimbursement', 'received_payment', 'scope_adjustment', 'scope_increase', 'operational_cost', 'transfer'];
const STATUSES = ['pending', 'paid', 'reimbursed', 'canceled'];

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
    if (['expense', 'operational_cost', 'transfer'].includes(entry.type)) return 'Despesa';
    if (['income', 'reimbursement', 'received_payment', 'scope_adjustment', 'scope_increase'].includes(entry.type)) return 'Receita';
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

    await db.run(`
        INSERT INTO transactions (
            user_id, type, entity, category, amount, date, description, project_id, project_financial_entry_id
        )
        VALUES (?, ?, 'MEI', ?, ?, ?, ?, ?, ?)
    `, [
        entry.user_id,
        txType,
        entry.category || 'Projeto',
        toMoney(entry.amount),
        entry.date,
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
                return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });
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
            return res.status(500).json({ error: 'Erro ao listar lancamentos do projeto.' });
        }
    },

    async create(req, res) {
        try {
            const { id } = req.params;
            const {
                type,
                description,
                category,
                amount,
                date,
                status,
                payment_method,
                affects_project_total,
                affects_my_financial,
                reimbursable,
                notes,
                user_id
            } = req.body;
            const db = await connectDb();

            const project = await getProjectAccess(db, req.userId, id);
            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });
            if (!await canEditProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissao para criar lancamentos financeiros neste projeto.' });
            }

            if (!TYPES.includes(type) || !isNonEmptyString(description, 180) || !isNonEmptyString(category, 100) || !isDate(date)) {
                return res.status(400).json({ error: 'Tipo, descricao, categoria e data validos sao obrigatorios.' });
            }

            if (!isNonNegativeMoney(amount) || toMoney(amount) === 0) {
                return res.status(400).json({ error: 'Valor positivo e obrigatorio.' });
            }

            if (status && !STATUSES.includes(status)) {
                return res.status(400).json({ error: 'Status invalido.' });
            }

            const ownerUserId = user_id || req.userId;
            const result = await db.run(`
                INSERT INTO project_financial_entries (
                    project_id, team_id, user_id, created_by, type, description, category, amount, date, status,
                    payment_method, affects_project_total, affects_my_financial, reimbursable, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                id,
                project.team_id || project.client_team_id || null,
                ownerUserId,
                req.userId,
                type,
                description.trim(),
                category.trim(),
                toMoney(amount),
                date,
                status || 'pending',
                payment_method || null,
                normalizeBoolean(affects_project_total),
                normalizeBoolean(affects_my_financial),
                normalizeBoolean(reimbursable),
                notes || null
            ]);

            const entry = await db.get('SELECT * FROM project_financial_entries WHERE id = ?', [result.lastID]);
            await syncPersonalTransaction(db, entry);

            await logActivity(db, req.userId, 'create_financial_entry', 'project', id, { entry_id: result.lastID, type });
            return res.status(201).json({ id: result.lastID, message: 'Lancamento do projeto criado.' });
        } catch (error) {
            console.error('[ProjectFinancialController.create]', error);
            return res.status(500).json({ error: 'Erro ao criar lancamento financeiro do projeto.' });
        }
    },

    async update(req, res) {
        try {
            const { id, entryId } = req.params;
            const db = await connectDb();

            if (!await canEditProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissao para editar lancamentos financeiros.' });
            }

            const entry = await getEntry(db, id, entryId);
            if (!entry) return res.status(404).json({ error: 'Lancamento nao encontrado.' });

            const {
                type,
                description,
                category,
                amount,
                date,
                status,
                payment_method,
                affects_project_total,
                affects_my_financial,
                reimbursable,
                reimbursed_at,
                notes
            } = req.body;

            if (type !== undefined && !TYPES.includes(type)) return res.status(400).json({ error: 'Tipo invalido.' });
            if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Status invalido.' });
            if (description !== undefined && !isNonEmptyString(description, 180)) return res.status(400).json({ error: 'Descricao invalida.' });
            if (category !== undefined && !isNonEmptyString(category, 100)) return res.status(400).json({ error: 'Categoria invalida.' });
            if (date !== undefined && !isDate(date)) return res.status(400).json({ error: 'Data invalida.' });
            if (amount !== undefined && (!isNonNegativeMoney(amount) || toMoney(amount) === 0)) return res.status(400).json({ error: 'Valor invalido.' });

            await db.run(`
                UPDATE project_financial_entries
                SET type = COALESCE(?, type),
                    description = COALESCE(?, description),
                    category = COALESCE(?, category),
                    amount = COALESCE(?, amount),
                    date = COALESCE(?, date),
                    status = COALESCE(?, status),
                    payment_method = COALESCE(?, payment_method),
                    affects_project_total = COALESCE(?, affects_project_total),
                    affects_my_financial = COALESCE(?, affects_my_financial),
                    reimbursable = COALESCE(?, reimbursable),
                    reimbursed_at = COALESCE(?, reimbursed_at),
                    notes = COALESCE(?, notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND project_id = ?
            `, [
                type,
                description === undefined ? null : description.trim(),
                category === undefined ? null : category.trim(),
                amount === undefined ? null : toMoney(amount),
                date,
                status,
                payment_method,
                affects_project_total === undefined ? null : normalizeBoolean(affects_project_total),
                affects_my_financial === undefined ? null : normalizeBoolean(affects_my_financial),
                reimbursable === undefined ? null : normalizeBoolean(reimbursable),
                reimbursed_at,
                notes,
                entryId,
                id
            ]);

            const updated = await getEntry(db, id, entryId);
            await syncPersonalTransaction(db, updated);

            await logActivity(db, req.userId, 'update_financial_entry', 'project', id, { entry_id: entryId });
            return res.json({ message: 'Lancamento atualizado.' });
        } catch (error) {
            console.error('[ProjectFinancialController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar lancamento financeiro.' });
        }
    },

    async updateStatus(req, res) {
        try {
            const { id, entryId } = req.params;
            const { status } = req.body;
            const db = await connectDb();

            if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Status invalido.' });
            if (!await canEditProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissao para alterar status financeiro.' });
            }

            const entry = await getEntry(db, id, entryId);
            if (!entry) return res.status(404).json({ error: 'Lancamento nao encontrado.' });

            await db.run(`
                UPDATE project_financial_entries
                SET status = ?,
                    reimbursed_at = CASE WHEN ? = 'reimbursed' THEN COALESCE(reimbursed_at, DATE('now')) ELSE reimbursed_at END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND project_id = ?
            `, [status, status, entryId, id]);

            const updated = await getEntry(db, id, entryId);
            await syncPersonalTransaction(db, updated);

            await logActivity(db, req.userId, 'update_financial_status', 'project', id, { entry_id: entryId, status });
            return res.json({ message: 'Status atualizado.' });
        } catch (error) {
            console.error('[ProjectFinancialController.updateStatus]', error);
            return res.status(500).json({ error: 'Erro ao atualizar status do lancamento.' });
        }
    },

    async destroy(req, res) {
        try {
            const { id, entryId } = req.params;
            const db = await connectDb();

            if (!await canEditProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissao para arquivar lancamentos financeiros.' });
            }

            const result = await db.run(`
                UPDATE project_financial_entries
                SET archived = 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND project_id = ?
            `, [entryId, id]);

            if (result.changes === 0) return res.status(404).json({ error: 'Lancamento nao encontrado.' });
            await logActivity(db, req.userId, 'archive_financial_entry', 'project', id, { entry_id: entryId });
            return res.json({ message: 'Lancamento arquivado.' });
        } catch (error) {
            console.error('[ProjectFinancialController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao arquivar lancamento.' });
        }
    },

    async summary(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            if (!await canViewProjectFinancials(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissao para visualizar resumo financeiro global.' });
            }

            return res.json(await getSummary(db, id));
        } catch (error) {
            console.error('[ProjectFinancialController.summary]', error);
            return res.status(500).json({ error: 'Erro ao carregar resumo financeiro do projeto.' });
        }
    }
};
