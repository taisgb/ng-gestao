const connectDb = require('../config/database');
const { isDate, isEmail, isNonEmptyString, isNonNegativeMoney, normalizeEmail, toMoney } = require('../utils/validators');
const {
    canEditProjectFinancials,
    canViewProjectFinancials,
    canEditTeamResource,
    canViewTeamResource,
    getProjectAccess: getSharedProjectAccess,
    isProjectOwner,
    PROJECT_BILLING_MODES,
    PROJECT_FINANCIAL_VISIBILITIES,
    sanitizeProjectForRole
} = require('../utils/permissions');
const { logActivity } = require('../utils/activityLog');

const DEFAULT_STATUSES = ['pendente', 'aprovado', 'em andamento', 'concluído', 'garantia'];

async function getProjectAccess(db, projectId, userId) {
    return getSharedProjectAccess(db, userId, projectId);
}

async function ensureDefaultStatuses(db, projectId) {
    const existing = await db.get(
        'SELECT COUNT(*) as total FROM project_statuses WHERE project_id = ?',
        [projectId]
    );

    if (existing.total > 0) return;

    for (let index = 0; index < DEFAULT_STATUSES.length; index += 1) {
        await db.run(
            'INSERT OR IGNORE INTO project_statuses (project_id, name, position) VALUES (?, ?, ?)',
            [projectId, DEFAULT_STATUSES[index], index + 1]
        );
    }
}

async function getProjectMembers(db, projectId) {
    return db.all(`
        SELECT u.id, u.name, u.email, pm.role, pm.created_at
        FROM project_members pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?
        UNION
        SELECT u.id, u.name, u.email, 'owner' as role, p.archived_at as created_at
        FROM projects p
        JOIN users u ON u.id = p.user_id
        WHERE p.id = ?
          AND NOT EXISTS (
            SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = p.user_id
          )
        ORDER BY 4 DESC, 2 ASC
    `, [projectId, projectId]);
}

async function ensureFinancialShares(db, projectId) {
    const members = await getProjectMembers(db, projectId);

    for (const member of members) {
        await db.run(`
            INSERT OR IGNORE INTO project_financial_shares (project_id, user_id, amount)
            VALUES (?, ?, 0)
        `, [projectId, member.id]);
    }

    return members;
}

function calculateWarrantyEndDate(startDate, days) {
    if (!startDate || !days) return null;
    const totalDays = Number(days);
    if (!Number.isInteger(totalDays) || totalDays <= 0) return null;
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + totalDays);
    return date.toISOString().split('T')[0];
}

function toDateOnly(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().split('T')[0];
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    return null;
}

function normalizeOptionalDate(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;

    const text = String(value).trim();
    if (!text) return null;

    const brDate = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brDate) return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;

    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

    return text;
}

function normalizeOptionalPositiveInteger(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;

    const number = Number(value);
    return Number.isInteger(number) ? number : Number.NaN;
}

function diffDays(fromDate, toDate) {
    const from = new Date(`${fromDate}T00:00:00Z`);
    const to = new Date(`${toDate}T00:00:00Z`);
    return Math.ceil((to.getTime() - from.getTime()) / 86400000);
}

module.exports = {
    async create(req, res) {
        try {
            const {
                client_id,
                name,
                title,
                description,
                base_value,
                value,
                payment_type,
                deadline,
                warranty_start_date,
                warranty_days,
                status,
                scope = 'individual',
                team_id,
                billing_mode = 'centralized',
                financial_visibility = 'shared_authorized',
                member_ids = []
            } = req.body;
            const db = await connectDb();
            const projectTitle = title || name;
            const projectValue = base_value !== undefined ? base_value : value;
            const projectScope = scope === 'team' ? 'team' : 'individual';

            if (!client_id || !isNonEmptyString(projectTitle, 160)) {
                return res.status(400).json({ error: 'Cliente e título são obrigatórios.' });
            }

            if (deadline && !isDate(deadline)) {
                return res.status(400).json({ error: 'Prazo inválido.' });
            }

            if (warranty_start_date && !isDate(warranty_start_date)) {
                return res.status(400).json({ error: 'Data inicial da garantia inválida.' });
            }

            if (warranty_days !== undefined && warranty_days !== '' && (!Number.isInteger(Number(warranty_days)) || Number(warranty_days) < 0)) {
                return res.status(400).json({ error: 'Prazo de garantia inválido.' });
            }

            if (projectValue !== undefined && !isNonNegativeMoney(projectValue)) {
                return res.status(400).json({ error: 'Valor do projeto inválido.' });
            }

            if (!PROJECT_BILLING_MODES.includes(billing_mode)) {
                return res.status(400).json({ error: 'Modo financeiro do projeto inválido.' });
            }

            if (!PROJECT_FINANCIAL_VISIBILITIES.includes(financial_visibility)) {
                return res.status(400).json({ error: 'Visibilidade financeira do projeto inválida.' });
            }

            const client = await db.get('SELECT id, user_id, team_id FROM clients WHERE id = ? AND archived = 0', [client_id]);

            if (!client) {
                return res.status(403).json({ error: 'Cliente não encontrado ou sem permissão.' });
            }

            const canUseClient = client.user_id === req.userId
                || (client.team_id && await canViewTeamResource(db, req.userId, client.team_id));
            if (!canUseClient) {
                return res.status(403).json({ error: 'Cliente não encontrado ou sem permissão.' });
            }

            let projectTeamId = null;
            const selectedMembers = Array.isArray(member_ids)
                ? [...new Set(member_ids.map(Number).filter(id => Number.isInteger(id) && id > 0 && id !== req.userId))]
                : [];

            if (projectScope === 'team') {
                projectTeamId = Number(team_id);
                if (!projectTeamId) {
                    return res.status(400).json({ error: 'Selecione o time do projeto.' });
                }

                if (!await canEditTeamResource(db, req.userId, projectTeamId)) {
                    return res.status(403).json({ error: 'Sem permissão para criar projetos neste time.' });
                }

                for (const memberId of selectedMembers) {
                    const membership = await db.get(
                        "SELECT id FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'",
                        [projectTeamId, memberId]
                    );

                    if (!membership) {
                        return res.status(400).json({ error: 'Todos os participantes precisam fazer parte do time selecionado.' });
                    }
                }
            }

            const user = await db.get('SELECT plan FROM users WHERE id = ?', [req.userId]);
            if (user.plan === 'free') {
                const count = await db.get('SELECT COUNT(*) as total FROM projects WHERE user_id = ? AND archived = 0', [req.userId]);
                if (count.total >= 5) {
                    return res.status(403).json({ error: 'Limite de 5 projetos atingido no plano Free. Faça upgrade para criar projetos ilimitados.' });
                }
            }

            const result = await db.run(`
                INSERT INTO projects (
                    client_id, team_id, scope, title, description, status, base_value, payment_type,
                    billing_mode, financial_visibility, deadline, warranty_start_date, warranty_days, warranty_end_date, user_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                client_id,
                projectTeamId,
                projectScope,
                projectTitle.trim(),
                description || null,
                status || 'pendente',
                toMoney(projectValue),
                payment_type || null,
                billing_mode,
                financial_visibility,
                deadline || null,
                warranty_start_date || null,
                Number(warranty_days || 0),
                calculateWarrantyEndDate(warranty_start_date, Number(warranty_days || 0)),
                req.userId
            ]);

            await ensureDefaultStatuses(db, result.lastID);
            await db.run(`
                INSERT OR IGNORE INTO project_members (project_id, user_id, role)
                VALUES (?, ?, 'owner')
            `, [result.lastID, req.userId]);

            if (projectScope === 'team') {
                for (const memberId of selectedMembers) {
                    await db.run(`
                        INSERT OR IGNORE INTO project_members (project_id, user_id, role)
                        VALUES (?, ?, 'member')
                    `, [result.lastID, memberId]);
                }
            }

            return res.status(201).json({ id: result.lastID, message: 'Projeto criado!' });
        } catch (error) {
            console.error('[ProjectController.create]', error);
            return res.status(500).json({ error: 'Erro ao criar projeto.' });
        }
    },

    async index(req, res) {
        try {
            const status = ['active', 'archived', 'all'].includes(req.query.status)
                ? req.query.status
                : 'active';
            const scopeFilter = ['individual', 'team'].includes(req.query.scope) ? req.query.scope : null;
            const db = await connectDb();
            const params = [req.userId, req.userId, req.userId, status, status, status];
            let scopeSql = '';
            if (scopeFilter) {
                scopeSql = ' AND p.scope = ?';
                params.push(scopeFilter);
            }
            params.push(req.userId);

            const projects = await db.all(`
                SELECT
                    p.*, 
                    clients.name as client_name,
                    teams.name as team_name,
                    tm.role as team_role,
                    CASE 
                        WHEN p.user_id = ? THEN 'owner'
                        WHEN project_members.user_id IS NOT NULL THEN project_members.role
                        WHEN tm.role IN ('owner', 'admin', 'gestor') THEN tm.role
                        ELSE NULL
                    END as access_role
                FROM projects p
                JOIN clients ON p.client_id = clients.id
                LEFT JOIN teams ON teams.id = p.team_id
                LEFT JOIN project_members 
                    ON project_members.project_id = p.id 
                    AND project_members.user_id = ?
                LEFT JOIN team_members tm
                    ON tm.team_id = p.team_id
                    AND tm.user_id = ?
                    AND tm.status = 'active'
                WHERE (
                    (? = 'active' AND p.archived = 0)
                    OR (? = 'archived' AND p.archived = 1)
                    OR ? = 'all'
                )
                  ${scopeSql}
                  AND (
                    p.user_id = ?
                    OR project_members.user_id IS NOT NULL
                    OR (p.scope = 'team' AND tm.role IN ('owner', 'admin', 'gestor'))
                  )
                ORDER BY p.archived ASC, p.id DESC
            `, params);

            const response = [];
            for (const project of projects) {
                const canSeeFinancials = await canViewProjectFinancials(db, req.userId, project.id);
                response.push(sanitizeProjectForRole({
                    ...project,
                    can_view_financials: canSeeFinancials,
                    base_value: canSeeFinancials ? project.base_value : null,
                    amount_paid: canSeeFinancials ? project.amount_paid : null
                }, canSeeFinancials));
            }

            return res.json(response);
        } catch (error) {
            console.error('[ProjectController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar projetos.' });
        }
    },

    async warrantyAlerts(req, res) {
        try {
            const db = await connectDb();
            const today = new Date().toISOString().split('T')[0];
            const daysAhead = Math.min(Math.max(Number(req.query.days || 15), 1), 60);
            const limit = Math.min(Math.max(Number(req.query.limit || 5), 1), 20);

            const projects = await db.all(`
                SELECT
                    p.id,
                    p.title,
                    p.status,
                    p.warranty_start_date,
                    p.warranty_days,
                    p.warranty_end_date,
                    p.team_id,
                    p.scope,
                    c.name as client_name,
                    t.name as team_name,
                    pm.role as project_role,
                    tm.role as team_role
                FROM projects p
                JOIN clients c ON c.id = p.client_id
                LEFT JOIN teams t ON t.id = p.team_id
                LEFT JOIN project_members pm
                    ON pm.project_id = p.id
                    AND pm.user_id = ?
                LEFT JOIN team_members tm
                    ON tm.team_id = p.team_id
                    AND tm.user_id = ?
                    AND tm.status = 'active'
                WHERE COALESCE(p.archived, 0) = 0
                  AND p.warranty_end_date IS NOT NULL
                  AND (
                    p.user_id = ?
                    OR pm.user_id IS NOT NULL
                    OR (p.scope = 'team' AND tm.role IN ('owner', 'admin', 'gestor'))
                  )
                ORDER BY p.warranty_end_date ASC, p.id DESC
            `, [req.userId, req.userId, req.userId]);

            const alerts = (projects || [])
                .map(project => {
                    const endDate = toDateOnly(project.warranty_end_date);
                    const days_remaining = diffDays(today, endDate);

                    return {
                        ...project,
                        warranty_start_date: toDateOnly(project.warranty_start_date),
                        warranty_end_date: endDate,
                        days_remaining,
                        alert_level: days_remaining < 0 ? 'overdue' : 'soon'
                    };
                })
                .filter(project => project.days_remaining <= daysAhead)
                .slice(0, limit);

            return res.json(alerts);
        } catch (error) {
            console.error('[ProjectController.warrantyAlerts]', error);
            return res.status(500).json({ error: 'Erro ao buscar garantias.' });
        }
    },

    async show(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const existingProject = await db.get('SELECT id FROM projects WHERE id = ?', [id]);
            if (!existingProject) {
                return res.status(404).json({ error: 'Projeto não encontrado.' });
            }

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) {
                return res.status(403).json({ error: 'Sem permissão para acessar este projeto.' });
            }

            const canSeeFinancials = await canViewProjectFinancials(db, req.userId, id);
            const expenses = await db.get(`
                SELECT SUM(amount) as total FROM transactions 
                WHERE project_id = ? AND type = 'Despesa' AND user_id = ?
            `, [id, req.userId]);

            const extraExpenses = expenses.total || 0;
            const totalProjectValue = project.base_value + extraExpenses;
            const response = sanitizeProjectForRole({
                ...project,
                can_view_financials: canSeeFinancials,
                can_edit_financials: await canEditProjectFinancials(db, req.userId, id),
                extra_expenses: canSeeFinancials ? extraExpenses : null,
                total_value: canSeeFinancials ? totalProjectValue : null,
                remaining_balance: canSeeFinancials ? totalProjectValue - project.amount_paid : null
            }, canSeeFinancials);

            if (!canSeeFinancials) {
                response.base_value = null;
                response.amount_paid = null;
                response.payment_type = null;
                response.payment_status = null;
                response.financial_notice = project.billing_mode === 'split_private'
                    ? 'As informações financeiras deste projeto são privadas.'
                    : 'Você visualiza apenas sua própria parte financeira neste projeto.';
            }

            return res.json(response);
        } catch (error) {
            console.error('[ProjectController.show]', error);
            return res.status(500).json({ error: 'Erro ao buscar detalhes.' });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const {
                title,
                name,
                description,
                client_id,
                status,
                base_value,
                value,
                payment_type,
                payment_status,
                amount_paid,
                deadline,
                scope,
                team_id,
                warranty_start_date,
                warranty_days,
                billing_mode,
                financial_visibility
            } = req.body;
            const db = await connectDb();
            const rawDeadline = deadline !== undefined ? deadline : req.body.due_date;
            const rawWarrantyStartDate = warranty_start_date !== undefined ? warranty_start_date : req.body.warranty_started_at;
            const rawWarrantyDays = warranty_days !== undefined ? warranty_days : req.body.warranty_duration_days;
            const normalizedDeadline = normalizeOptionalDate(rawDeadline);
            const normalizedWarrantyStartDate = normalizeOptionalDate(rawWarrantyStartDate);
            const normalizedWarrantyDays = normalizeOptionalPositiveInteger(rawWarrantyDays);

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });

            const requestedFields = Object.keys(req.body);
            const canEditFinancials = await canEditProjectFinancials(db, req.userId, id);
            const sensitiveFields = ['base_value', 'payment_type', 'payment_status', 'amount_paid', 'billing_mode', 'financial_visibility'];
            if (!canEditFinancials && requestedFields.some(field => sensitiveFields.includes(field))) {
                return res.status(403).json({ error: 'Sem permissão para editar valores financeiros do projeto.' });
            }

            if (!['owner', 'admin', 'gestor'].includes(project.access_role) && requestedFields.some(field => field !== 'status')) {
                return res.status(403).json({ error: 'Membros podem alterar apenas o status operacional do projeto.' });
            }

            const nextTitle = title !== undefined ? title : name;
            if (nextTitle !== undefined && !isNonEmptyString(nextTitle, 160)) {
                return res.status(400).json({ error: 'Título inválido.' });
            }

            if (normalizedDeadline !== undefined && normalizedDeadline !== null && !isDate(normalizedDeadline)) {
                return res.status(400).json({ error: 'Prazo do projeto inválido.' });
            }

            const nextBaseValue = base_value !== undefined ? base_value : value;
            if (nextBaseValue !== undefined && !isNonNegativeMoney(nextBaseValue)) {
                return res.status(400).json({ error: 'Valor do projeto inválido.' });
            }

            if (amount_paid !== undefined && !isNonNegativeMoney(amount_paid)) {
                return res.status(400).json({ error: 'Valor pago inválido.' });
            }

            if (normalizedWarrantyStartDate !== undefined && normalizedWarrantyStartDate !== null && !isDate(normalizedWarrantyStartDate)) {
                return res.status(400).json({ error: 'Data de início da garantia inválida.' });
            }

            if (normalizedWarrantyDays !== undefined && normalizedWarrantyDays !== null && (!Number.isInteger(normalizedWarrantyDays) || normalizedWarrantyDays <= 0)) {
                return res.status(400).json({ error: 'Prazo da garantia inválido.' });
            }

            if (billing_mode !== undefined && !PROJECT_BILLING_MODES.includes(billing_mode)) {
                return res.status(400).json({ error: 'Modo financeiro do projeto inválido.' });
            }

            if (financial_visibility !== undefined && !PROJECT_FINANCIAL_VISIBILITIES.includes(financial_visibility)) {
                return res.status(400).json({ error: 'Visibilidade financeira do projeto inválida.' });
            }

            let nextClientId = project.client_id;
            if (client_id !== undefined) {
                const client = await db.get('SELECT id, user_id, team_id FROM clients WHERE id = ? AND archived = 0', [client_id]);
                if (!client) return res.status(403).json({ error: 'Cliente não encontrado ou sem permissão.' });

                const canUseClient = client.user_id === req.userId
                    || (client.team_id && await canViewTeamResource(db, req.userId, client.team_id));
                if (!canUseClient) return res.status(403).json({ error: 'Cliente não encontrado ou sem permissão.' });
                nextClientId = Number(client_id);
            }

            const nextScope = scope !== undefined ? (scope === 'team' ? 'team' : 'individual') : project.scope || 'individual';
            let nextTeamId = project.team_id || null;
            if (nextScope === 'individual') {
                nextTeamId = null;
            } else if (team_id !== undefined || scope !== undefined) {
                nextTeamId = Number(team_id || project.team_id);
                if (!nextTeamId) return res.status(400).json({ error: 'Selecione o time do projeto.' });
                if (!await canEditTeamResource(db, req.userId, nextTeamId)) {
                    return res.status(403).json({ error: 'Sem permissão para vincular este projeto ao time selecionado.' });
                }
            }

            if (status) {
                await ensureDefaultStatuses(db, id);
                const statusExists = await db.get(
                    'SELECT id FROM project_statuses WHERE project_id = ? AND LOWER(name) = LOWER(?)',
                    [id, status]
                );

                if (!statusExists) {
                    return res.status(400).json({ error: 'Status inválido para este projeto.' });
                }
            }

            const isWarrantyEdit = status !== undefined || rawWarrantyStartDate !== undefined || rawWarrantyDays !== undefined;
            const nextProjectStatus = String(status !== undefined ? status : project.status || '').toLowerCase().trim();
            const nextWarrantyStartForValidation = rawWarrantyStartDate === undefined
                ? toDateOnly(project.warranty_start_date)
                : normalizedWarrantyStartDate;
            const nextWarrantyDaysForValidation = rawWarrantyDays === undefined
                ? Number(project.warranty_days || 0)
                : normalizedWarrantyDays;

            if (isWarrantyEdit && nextProjectStatus === 'garantia') {
                if (!nextWarrantyStartForValidation) {
                    return res.status(400).json({ error: 'Data de início da garantia inválida.' });
                }
                if (!Number.isInteger(Number(nextWarrantyDaysForValidation)) || Number(nextWarrantyDaysForValidation) <= 0) {
                    return res.status(400).json({ error: 'Prazo da garantia inválido.' });
                }
            }

            const updates = [];
            const params = [];
            function addField(field, value) {
                updates.push(`${field} = ?`);
                params.push(value);
            }

            if (nextTitle !== undefined) addField('title', nextTitle.trim());
            if (description !== undefined) addField('description', description || null);
            if (client_id !== undefined) addField('client_id', nextClientId);
            if (status !== undefined) addField('status', status);
            if (nextBaseValue !== undefined) addField('base_value', toMoney(nextBaseValue));
            if (payment_type !== undefined) addField('payment_type', payment_type || null);
            if (payment_status !== undefined) addField('payment_status', payment_status || null);
            if (amount_paid !== undefined) addField('amount_paid', toMoney(amount_paid));
            if (billing_mode !== undefined) addField('billing_mode', billing_mode);
            if (financial_visibility !== undefined) addField('financial_visibility', financial_visibility);
            if (rawDeadline !== undefined) addField('deadline', normalizedDeadline);
            if (scope !== undefined) addField('scope', nextScope);
            if (team_id !== undefined || scope !== undefined) addField('team_id', nextTeamId);

            const hasWarrantyChange = rawWarrantyStartDate !== undefined || rawWarrantyDays !== undefined;
            if (hasWarrantyChange) {
                const start = rawWarrantyStartDate === undefined ? project.warranty_start_date : normalizedWarrantyStartDate;
                const days = rawWarrantyDays === undefined ? Number(project.warranty_days || 0) : normalizedWarrantyDays;
                addField('warranty_start_date', start);
                addField('warranty_days', days);
                addField('warranty_end_date', calculateWarrantyEndDate(start, days));
            }

            if (updates.length === 0) return res.json({ message: 'Nenhuma alteração enviada.' });

            await db.run(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);

            await logActivity(db, req.userId, 'update_project', 'project', id, {
                fields: requestedFields
            });

            return res.json({ message: 'Projeto atualizado.' });
        } catch (error) {
            console.error('[ProjectController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar projeto.' });
        }
    },

    async share(req, res) {
        try {
            const { id } = req.params;
            const email = normalizeEmail(req.body.email);
            const db = await connectDb();

            if (!isEmail(email)) {
                return res.status(400).json({ error: 'Informe um email válido.' });
            }

            const project = await db.get(
                'SELECT id, user_id FROM projects WHERE id = ? AND user_id = ? AND archived = 0',
                [id, req.userId]
            );

            if (!project) {
                return res.status(403).json({ error: 'Apenas o dono do projeto pode compartilhar.' });
            }

            const collaborator = await db.get('SELECT id, name, email FROM users WHERE email = ?', [email]);
            if (!collaborator) {
                return res.status(404).json({ error: 'Usuário não encontrado.' });
            }

            if (collaborator.id === req.userId) {
                return res.status(400).json({ error: 'Você já é o dono deste projeto.' });
            }

            await db.run(`
                INSERT OR IGNORE INTO project_members (project_id, user_id, role)
                VALUES (?, ?, 'collaborator')
            `, [id, collaborator.id]);

            await db.run(`
                INSERT OR IGNORE INTO project_financial_shares (project_id, user_id, amount)
                VALUES (?, ?, 0)
            `, [id, collaborator.id]);

            return res.status(201).json({
                message: 'Projeto compartilhado.',
                member: collaborator
            });
        } catch (error) {
            console.error('[ProjectController.share]', error);
            return res.status(500).json({ error: 'Erro ao compartilhar projeto.' });
        }
    },

    async transferOwner(req, res) {
        try {
            const { id } = req.params;
            const newOwnerId = Number(req.body.new_owner_id || req.body.user_id);

            if (!Number.isInteger(newOwnerId) || newOwnerId <= 0) {
                return res.status(400).json({ error: 'Informe o novo dono do projeto.' });
            }

            const db = await connectDb();
            const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);

            if (!project) {
                return res.status(404).json({ error: 'Projeto não encontrado.' });
            }

            if (!isProjectOwner(project, req.userId)) {
                return res.status(403).json({ error: 'Apenas o dono atual pode repassar este projeto.' });
            }

            if (Number(project.user_id) === newOwnerId) {
                return res.status(400).json({ error: 'Este usuário já é o dono do projeto.' });
            }

            const newOwner = await db.get('SELECT id, name, email FROM users WHERE id = ?', [newOwnerId]);
            if (!newOwner) {
                return res.status(404).json({ error: 'Novo dono não encontrado.' });
            }

            const newOwnerAccess = await getSharedProjectAccess(db, newOwnerId, id);
            if (!newOwnerAccess) {
                return res.status(403).json({ error: 'O novo dono precisa já ter acesso ao projeto.' });
            }

            await db.run('UPDATE projects SET user_id = ? WHERE id = ?', [newOwnerId, id]);
            await db.run(`
                INSERT OR IGNORE INTO project_members (project_id, user_id, role)
                VALUES (?, ?, 'collaborator')
            `, [id, req.userId]);
            await db.run(`
                INSERT OR IGNORE INTO project_members (project_id, user_id, role)
                VALUES (?, ?, 'owner')
            `, [id, newOwnerId]);
            await db.run(
                "UPDATE project_members SET role = 'collaborator', updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND user_id = ?",
                [id, req.userId]
            );
            await db.run(
                "UPDATE project_members SET role = 'owner', updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND user_id = ?",
                [id, newOwnerId]
            );
            await db.run(`
                INSERT OR IGNORE INTO project_financial_shares (project_id, user_id, amount)
                VALUES (?, ?, 0)
            `, [id, newOwnerId]);

            await logActivity(db, req.userId, 'transfer_owner', 'project', id, { new_owner_id: newOwnerId });
            return res.json({
                message: 'Dono do projeto atualizado.',
                owner: newOwner
            });
        } catch (error) {
            console.error('[ProjectController.transferOwner]', error);
            return res.status(500).json({ error: 'Erro ao repassar projeto.' });
        }
    },

    async members(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });

            const members = await getProjectMembers(db, id);

            return res.json(members);
        } catch (error) {
            console.error('[ProjectController.members]', error);
            return res.status(500).json({ error: 'Erro ao listar colaboradores.' });
        }
    },

    async removeMember(req, res) {
        try {
            const { projectId, memberId } = req.params;
            const targetUserId = Number(memberId);
            const db = await connectDb();

            if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
                return res.status(400).json({ error: 'Membro inválido.' });
            }

            const project = await getProjectAccess(db, projectId, req.userId);
            if (!project) {
                return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });
            }

            const isTeamEditor = project.scope === 'team' && ['owner', 'admin', 'gestor'].includes(project.access_role);
            const canRemove = project.access_role === 'owner' || isTeamEditor;
            if (!canRemove) {
                return res.status(403).json({ error: 'Sem permissão para remover membros deste projeto.' });
            }

            if (Number(project.user_id) === targetUserId) {
                return res.status(403).json({ error: 'Transfira a propriedade antes de remover o dono atual.' });
            }

            const member = await db.get(
                'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
                [projectId, targetUserId]
            );
            if (!member) {
                return res.status(404).json({ error: 'Membro não encontrado neste projeto.' });
            }
            if (member.role === 'owner') {
                return res.status(403).json({ error: 'Transfira a propriedade antes de remover o dono atual.' });
            }

            await db.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, targetUserId]);
            await db.run('DELETE FROM project_financial_shares WHERE project_id = ? AND user_id = ?', [projectId, targetUserId]);

            await logActivity(db, req.userId, 'remove_member', 'project', projectId, { member_id: targetUserId });
            return res.json({ message: 'Membro removido do projeto.' });
        } catch (error) {
            console.error('[ProjectController.removeMember]', error);
            return res.status(500).json({ error: 'Erro ao remover membro do projeto.' });
        }
    },

    async statuses(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });

            await ensureDefaultStatuses(db, id);

            const statuses = await db.all(
                'SELECT * FROM project_statuses WHERE project_id = ? ORDER BY position ASC, name ASC',
                [id]
            );

            return res.json(statuses);
        } catch (error) {
            console.error('[ProjectController.statuses]', error);
            return res.status(500).json({ error: 'Erro ao listar status.' });
        }
    },

    async createStatus(req, res) {
        try {
            const { id } = req.params;
            const { name } = req.body;
            const db = await connectDb();

            if (!isNonEmptyString(name, 80)) {
                return res.status(400).json({ error: 'Informe o nome do status.' });
            }

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });

            const nextPosition = await db.get(
                'SELECT COALESCE(MAX(position), 0) + 1 as position FROM project_statuses WHERE project_id = ?',
                [id]
            );

            const result = await db.run(
                'INSERT INTO project_statuses (project_id, name, position) VALUES (?, ?, ?)',
                [id, name.trim(), nextPosition.position]
            );

            return res.status(201).json({ id: result.lastID, name: name.trim(), position: nextPosition.position });
        } catch (error) {
            if (error.message && error.message.includes('UNIQUE')) {
                return res.status(400).json({ error: 'Este status já existe no projeto.' });
            }

            console.error('[ProjectController.createStatus]', error);
            return res.status(500).json({ error: 'Erro ao criar status.' });
        }
    },

    async notes(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });

            const notes = await db.all(`
                SELECT pn.*, u.name as author_name
                FROM project_notes pn
                JOIN users u ON u.id = pn.user_id
                WHERE pn.project_id = ?
                ORDER BY pn.created_at DESC
            `, [id]);

            return res.json(notes);
        } catch (error) {
            console.error('[ProjectController.notes]', error);
            return res.status(500).json({ error: 'Erro ao listar anotacoes.' });
        }
    },

    async createNote(req, res) {
        try {
            const { id } = req.params;
            const { note } = req.body;
            const db = await connectDb();

            if (!isNonEmptyString(note, 2000)) {
                return res.status(400).json({ error: 'Escreva uma anotação.' });
            }

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });

            const result = await db.run(
                'INSERT INTO project_notes (project_id, user_id, note) VALUES (?, ?, ?)',
                [id, req.userId, note.trim()]
            );

            const created = await db.get(`
                SELECT pn.*, u.name as author_name
                FROM project_notes pn
                JOIN users u ON u.id = pn.user_id
                WHERE pn.id = ?
            `, [result.lastID]);

            return res.status(201).json(created);
        } catch (error) {
            console.error('[ProjectController.createNote]', error);
            return res.status(500).json({ error: 'Erro ao criar anotação.' });
        }
    },

    async finance(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });

            await ensureFinancialShares(db, id);
            const canViewGlobal = await canViewProjectFinancials(db, req.userId, id);

            const rows = await db.all(`
                SELECT 
                    pfs.user_id,
                    pfs.amount,
                    pfs.updated_at,
                    u.name,
                    u.email,
                    CASE 
                        WHEN p.user_id = u.id THEN 'owner'
                        ELSE COALESCE(pm.role, 'collaborator')
                    END as role
                FROM project_financial_shares pfs
                JOIN users u ON u.id = pfs.user_id
                JOIN projects p ON p.id = pfs.project_id
                LEFT JOIN project_members pm 
                    ON pm.project_id = pfs.project_id AND pm.user_id = pfs.user_id
                WHERE pfs.project_id = ?
                  AND (? = 1 OR pfs.user_id = ?)
                ORDER BY role DESC, u.name ASC
            `, [id, canViewGlobal ? 1 : 0, req.userId]);

            const totalValue = Number(project.base_value || 0);
            const allocationTotal = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
            const canEditFinancials = await canEditProjectFinancials(db, req.userId, id);

            return res.json({
                total_value: canViewGlobal ? totalValue : null,
                allocation_total: canViewGlobal ? allocationTotal : null,
                unallocated_amount: canViewGlobal ? totalValue - allocationTotal : null,
                can_view_global: canViewGlobal,
                can_edit_total: canEditFinancials,
                can_edit_all_shares: canEditFinancials,
                shares: rows.map(row => ({
                    user_id: row.user_id,
                    name: row.name,
                    email: row.email,
                    role: row.role,
                    amount: Number(row.amount || 0),
                    percentage: canViewGlobal && totalValue > 0 ? (Number(row.amount || 0) / totalValue) * 100 : null,
                    can_edit: canEditFinancials,
                    updated_at: row.updated_at
                }))
            });
        } catch (error) {
            console.error('[ProjectController.finance]', error);
            return res.status(500).json({ error: 'Erro ao carregar divisão financeira.' });
        }
    },

    async updateFinance(req, res) {
        try {
            const { id } = req.params;
            const { total_value, shares } = req.body;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });
            const canEditFinancials = await canEditProjectFinancials(db, req.userId, id);

            if (!canEditFinancials) {
                return res.status(403).json({ error: 'Sem permissão para editar a divisão financeira do projeto.' });
            }

            await ensureFinancialShares(db, id);

            if (total_value !== undefined) {
                if (!isNonNegativeMoney(total_value)) {
                    return res.status(400).json({ error: 'Valor total inválido.' });
                }

                await db.run('UPDATE projects SET base_value = ? WHERE id = ?', [toMoney(total_value), id]);
            }

            if (Array.isArray(shares)) {
                for (const share of shares) {
                    const userId = Number(share.user_id);
                    const amount = toMoney(share.amount);

                    if (!userId || !isNonNegativeMoney(amount)) {
                        return res.status(400).json({ error: 'Participante ou valor inválido.' });
                    }

                    const member = await db.get(`
                        SELECT p.user_id
                        FROM projects p
                        LEFT JOIN project_members pm 
                            ON pm.project_id = p.id AND pm.user_id = ?
                        WHERE p.id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)
                    `, [userId, id, userId]);

                    if (!member) {
                        return res.status(400).json({ error: 'Participante inválido para este projeto.' });
                    }

                    await db.run(`
                        INSERT INTO project_financial_shares (project_id, user_id, amount, updated_at)
                        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(project_id, user_id) DO UPDATE SET
                            amount = excluded.amount,
                            updated_at = CURRENT_TIMESTAMP
                    `, [id, userId, amount]);
                }
            }

            return res.json({ message: 'Divisão financeira atualizada.' });
        } catch (error) {
            console.error('[ProjectController.updateFinance]', error);
            return res.status(500).json({ error: 'Erro ao atualizar divisão financeira.' });
        }
    },

    async archive(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const project = await getProjectAccess(db, id, req.userId);

            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });
            if (!['owner', 'admin', 'gestor'].includes(project.access_role)) {
                return res.status(403).json({ error: 'Sem permissão para arquivar este projeto.' });
            }

            await db.run(
                'UPDATE projects SET archived = 1, archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE id = ?',
                [id]
            );
            await logActivity(db, req.userId, 'archive', 'project', id);
            return res.json({ message: 'Projeto arquivado.' });
        } catch (error) {
            console.error('[ProjectController.archive]', error);
            return res.status(500).json({ error: 'Erro ao arquivar.' });
        }
    },

    async restore(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const project = await getProjectAccess(db, id, req.userId);

            if (!project) return res.status(404).json({ error: 'Projeto não encontrado ou acesso negado.' });
            if (!['owner', 'admin', 'gestor'].includes(project.access_role)) {
                return res.status(403).json({ error: 'Sem permissão para restaurar este projeto.' });
            }

            await db.run('UPDATE projects SET archived = 0, archived_at = NULL WHERE id = ?', [id]);
            await logActivity(db, req.userId, 'restore', 'project', id);
            return res.json({ message: 'Projeto restaurado.' });
        } catch (error) {
            console.error('[ProjectController.restore]', error);
            return res.status(500).json({ error: 'Erro ao restaurar projeto.' });
        }
    },

    async destroy(req, res) {
        return module.exports.archive(req, res);
    }
};
