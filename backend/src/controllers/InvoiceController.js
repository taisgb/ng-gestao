const connectDb = require('../config/database');
const { isDate, isNonEmptyString, isNonNegativeMoney, toMoney } = require('../utils/validators');
const {
    canEditInvoice,
    canEditProjectFinancials,
    canViewInvoice,
    sanitizeInvoiceForRole
} = require('../utils/permissions');

const ALLOWED_STATUSES = ['pendente', 'emitida', 'enviada', 'paga', 'cancelada'];
const COMPANY_LIMITS = {
    mei: 81000,
    me: 360000
};

async function getInvoice(db, id) {
    return db.get(`
        SELECT i.*, p.title as project_title, p.team_id, t.name as team_name
        FROM invoices i
        LEFT JOIN projects p ON p.id = i.project_id
        LEFT JOIN teams t ON t.id = p.team_id
        WHERE i.id = ?
    `, [id]);
}

module.exports = {
    async create(req, res) {
        try {
            const { project_id, number, client_name, description, amount, issue_date, status } = req.body;

            if (!isNonEmptyString(client_name, 160) || !isDate(issue_date) || !isNonNegativeMoney(amount)) {
                return res.status(400).json({ error: 'Cliente, data de emissao e valor valido sao obrigatorios.' });
            }

            if (status && !ALLOWED_STATUSES.includes(status)) {
                return res.status(400).json({ error: 'Status de nota fiscal invalido.' });
            }

            const db = await connectDb();

            if (project_id) {
                const canEditProject = await canEditProjectFinancials(db, req.userId, project_id);
                if (!canEditProject) {
                    return res.status(403).json({ error: 'Sem permissao financeira para registrar NF neste projeto.' });
                }
            }

            const result = await db.run(`
                INSERT INTO invoices (user_id, project_id, number, client_name, description, amount, issue_date, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                req.userId,
                project_id || null,
                number || null,
                client_name.trim(),
                description || null,
                toMoney(amount),
                issue_date,
                status || 'pendente'
            ]);

            return res.status(201).json({ id: result.lastID, message: 'Nota fiscal registrada.' });
        } catch (error) {
            console.error('[InvoiceController.create]', error);
            return res.status(500).json({ error: 'Erro ao registrar nota fiscal.' });
        }
    },

    async index(req, res) {
        try {
            const { status, month, year, project_id } = req.query;
            const db = await connectDb();

            let query = `
                SELECT i.*, p.title as project_title, p.team_id, t.name as team_name
                FROM invoices i
                LEFT JOIN projects p ON p.id = i.project_id
                LEFT JOIN teams t ON t.id = p.team_id
                LEFT JOIN project_members pm 
                    ON pm.project_id = i.project_id 
                    AND pm.user_id = ?
                LEFT JOIN team_members tm
                    ON tm.team_id = p.team_id
                    AND tm.user_id = ?
                    AND tm.status = 'active'
                WHERE (
                    i.user_id = ?
                    OR p.user_id = ?
                    OR pm.user_id IS NOT NULL
                    OR tm.user_id IS NOT NULL
                )
            `;
            const params = [req.userId, req.userId, req.userId, req.userId];

            if (status) {
                query += ' AND i.status = ?';
                params.push(status);
            }

            if (project_id) {
                query += ' AND i.project_id = ?';
                params.push(project_id);
            }

            if (month && year) {
                query += " AND strftime('%m', i.issue_date) = ? AND strftime('%Y', i.issue_date) = ?";
                params.push(month.padStart(2, '0'), year);
            }

            query += ' ORDER BY i.issue_date DESC, i.id DESC';

            const invoices = await db.all(query, params);
            const visible = [];

            for (const invoice of invoices) {
                const canView = await canViewInvoice(db, req.userId, invoice);
                if (!canView) continue;
                visible.push(sanitizeInvoiceForRole({
                    ...invoice,
                    can_edit: await canEditInvoice(db, req.userId, invoice)
                }, true));
            }

            return res.json(visible);
        } catch (error) {
            console.error('[InvoiceController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar notas fiscais.' });
        }
    },

    async fiscalSettings(req, res) {
        try {
            const db = await connectDb();
            let settings = await db.get('SELECT * FROM user_fiscal_settings WHERE user_id = ?', [req.userId]);

            if (!settings) {
                await db.run(
                    "INSERT INTO user_fiscal_settings (user_id, company_type, annual_revenue_limit) VALUES (?, 'mei', ?)",
                    [req.userId, COMPANY_LIMITS.mei]
                );
                settings = await db.get('SELECT * FROM user_fiscal_settings WHERE user_id = ?', [req.userId]);
            }

            return res.json(settings);
        } catch (error) {
            console.error('[InvoiceController.fiscalSettings]', error);
            return res.status(500).json({ error: 'Erro ao carregar configuracao fiscal.' });
        }
    },

    async updateFiscalSettings(req, res) {
        try {
            const { company_type, opening_date, use_proportional_limit } = req.body;

            if (!['mei', 'me'].includes(company_type)) {
                return res.status(400).json({ error: 'Enquadramento fiscal invalido.' });
            }

            if (opening_date && !isDate(opening_date)) {
                return res.status(400).json({ error: 'Data de abertura invalida.' });
            }

            const annualLimit = COMPANY_LIMITS[company_type];
            const db = await connectDb();

            await db.run(`
                INSERT INTO user_fiscal_settings (
                    user_id, company_type, annual_revenue_limit, opening_date, use_proportional_limit, updated_at
                )
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    company_type = excluded.company_type,
                    annual_revenue_limit = excluded.annual_revenue_limit,
                    opening_date = excluded.opening_date,
                    use_proportional_limit = excluded.use_proportional_limit,
                    updated_at = CURRENT_TIMESTAMP
            `, [req.userId, company_type, annualLimit, opening_date || null, use_proportional_limit ? 1 : 0]);

            const settings = await db.get('SELECT * FROM user_fiscal_settings WHERE user_id = ?', [req.userId]);
            return res.json(settings);
        } catch (error) {
            console.error('[InvoiceController.updateFiscalSettings]', error);
            return res.status(500).json({ error: 'Erro ao salvar configuracao fiscal.' });
        }
    },

    async summary(req, res) {
        try {
            const year = String(req.query.year || new Date().getFullYear());
            if (!/^\d{4}$/.test(year)) {
                return res.status(400).json({ error: 'Ano fiscal invalido.' });
            }

            const db = await connectDb();
            let settings = await db.get('SELECT * FROM user_fiscal_settings WHERE user_id = ?', [req.userId]);
            if (!settings) {
                await db.run(
                    "INSERT INTO user_fiscal_settings (user_id, company_type, annual_revenue_limit) VALUES (?, 'mei', ?)",
                    [req.userId, COMPANY_LIMITS.mei]
                );
                settings = await db.get('SELECT * FROM user_fiscal_settings WHERE user_id = ?', [req.userId]);
            }

            const rows = await db.all(`
                SELECT status, amount
                FROM invoices
                WHERE user_id = ? AND strftime('%Y', issue_date) = ?
            `, [req.userId, year]);

            const totalFiltered = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
            const pendingCount = rows.filter(row => row.status === 'pendente').length;
            const issuedCount = rows.filter(row => ['emitida', 'enviada'].includes(row.status)).length;
            const paidCount = rows.filter(row => row.status === 'paga').length;
            const totalRevenueYear = rows
                .filter(row => ['emitida', 'enviada', 'paga'].includes(row.status))
                .reduce((sum, row) => sum + Number(row.amount || 0), 0);
            const annualLimit = Number(settings.annual_revenue_limit || COMPANY_LIMITS[settings.company_type] || COMPANY_LIMITS.mei);
            const usedPercentage = annualLimit > 0 ? (totalRevenueYear / annualLimit) * 100 : 0;
            const alertLevel =
                usedPercentage > 100 ? 'exceeded' :
                usedPercentage > 90 ? 'danger' :
                usedPercentage >= 70 ? 'warning' :
                'normal';

            return res.json({
                total_filtered: totalFiltered,
                pending_count: pendingCount,
                issued_count: issuedCount,
                paid_count: paidCount,
                fiscal_year: Number(year),
                company_type: settings.company_type,
                annual_revenue_limit: annualLimit,
                total_revenue_year: totalRevenueYear,
                remaining_limit: annualLimit - totalRevenueYear,
                used_percentage: usedPercentage,
                alert_level: alertLevel
            });
        } catch (error) {
            console.error('[InvoiceController.summary]', error);
            return res.status(500).json({ error: 'Erro ao carregar resumo fiscal.' });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const { number, client_name, description, amount, issue_date, status, project_id } = req.body;

            if (client_name !== undefined && !isNonEmptyString(client_name, 160)) {
                return res.status(400).json({ error: 'Cliente invalido.' });
            }

            if (issue_date !== undefined && !isDate(issue_date)) {
                return res.status(400).json({ error: 'Data de emissao invalida.' });
            }

            if (amount !== undefined && !isNonNegativeMoney(amount)) {
                return res.status(400).json({ error: 'Valor invalido.' });
            }

            if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
                return res.status(400).json({ error: 'Status de nota fiscal invalido.' });
            }

            const db = await connectDb();
            const invoice = await getInvoice(db, id);

            if (!invoice) {
                return res.status(404).json({ error: 'Nota fiscal nao encontrada.' });
            }

            if (!await canEditInvoice(db, req.userId, invoice)) {
                return res.status(403).json({ error: 'Sem permissao para editar esta nota fiscal.' });
            }

            if (project_id) {
                const canEditProject = await canEditProjectFinancials(db, req.userId, project_id);
                if (!canEditProject) return res.status(403).json({ error: 'Sem permissao financeira para vincular esta NF ao projeto.' });
            }

            const result = await db.run(`
                UPDATE invoices
                SET project_id = COALESCE(?, project_id),
                    number = COALESCE(?, number),
                    client_name = COALESCE(?, client_name),
                    description = COALESCE(?, description),
                    amount = COALESCE(?, amount),
                    issue_date = COALESCE(?, issue_date),
                    status = COALESCE(?, status)
                WHERE id = ?
            `, [
                project_id === undefined ? null : project_id || null,
                number,
                client_name === undefined ? null : client_name.trim(),
                description,
                amount === undefined ? null : toMoney(amount),
                issue_date,
                status,
                id
            ]);

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Nota fiscal nao encontrada.' });
            }

            return res.json({ message: 'Nota fiscal atualizada.' });
        } catch (error) {
            console.error('[InvoiceController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar nota fiscal.' });
        }
    },

    async destroy(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const invoice = await getInvoice(db, id);

            if (!invoice) {
                return res.status(404).json({ error: 'Nota fiscal nao encontrada.' });
            }

            if (!await canEditInvoice(db, req.userId, invoice)) {
                return res.status(403).json({ error: 'Sem permissao para remover esta nota fiscal.' });
            }

            await db.run('DELETE FROM invoices WHERE id = ?', [id]);

            return res.json({ message: 'Nota fiscal removida.' });
        } catch (error) {
            console.error('[InvoiceController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao remover nota fiscal.' });
        }
    }
};
