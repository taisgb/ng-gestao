const connectDb = require('../config/database');
const { isDate, isEmail, isNonEmptyString, isNonNegativeMoney, normalizeEmail, toMoney } = require('../utils/validators');
const {
    canEditProjectFinancials,
    canViewProjectFinancials,
    canEditTeamResource,
    getProjectAccess: getSharedProjectAccess
} = require('../utils/permissions');

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
        SELECT u.id, u.name, u.email, 'owner' as role, NULL as created_at
        FROM projects p
        JOIN users u ON u.id = p.user_id
        WHERE p.id = ?
        UNION ALL
        SELECT u.id, u.name, u.email, pm.role, pm.created_at
        FROM project_members pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?
        UNION
        SELECT u.id, u.name, u.email, tm.role, tm.created_at
        FROM projects p
        JOIN clients c ON c.id = p.client_id
        JOIN team_members tm ON tm.team_id = COALESCE(p.team_id, c.team_id) AND tm.status = 'active'
        JOIN users u ON u.id = tm.user_id
        WHERE p.id = ?
        ORDER BY 4 DESC, 2 ASC
    `, [projectId, projectId, projectId]);
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

module.exports = {
    async create(req, res) {
        try {
            const { client_id, title, description, base_value, payment_type, deadline } = req.body;
            const db = await connectDb();

            if (!client_id || !isNonEmptyString(title, 160)) {
                return res.status(400).json({ error: 'Cliente e titulo sao obrigatorios.' });
            }

            if (deadline && !isDate(deadline)) {
                return res.status(400).json({ error: 'Prazo invalido.' });
            }

            if (base_value !== undefined && !isNonNegativeMoney(base_value)) {
                return res.status(400).json({ error: 'Valor do projeto invalido.' });
            }

            const client = await db.get('SELECT id, user_id, team_id FROM clients WHERE id = ? AND archived = 0', [client_id]);

            if (!client || (client.user_id !== req.userId && !client.team_id)) {
                return res.status(403).json({ error: 'Cliente nao encontrado ou sem permissao.' });
            }

            if (client.team_id && !await canEditTeamResource(db, req.userId, client.team_id)) {
                return res.status(403).json({ error: 'Sem permissao para criar projetos neste time.' });
            }

            const user = await db.get('SELECT plan FROM users WHERE id = ?', [req.userId]);
            if (user.plan === 'free') {
                const count = await db.get('SELECT COUNT(*) as total FROM projects WHERE user_id = ? AND archived = 0', [req.userId]);
                if (count.total >= 5) {
                    return res.status(403).json({ error: 'Limite de 5 projetos atingido no plano Free. Faca upgrade para criar projetos ilimitados.' });
                }
            }

            const result = await db.run(`
                INSERT INTO projects (client_id, team_id, title, description, base_value, payment_type, deadline, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [client_id, client.team_id || null, title.trim(), description || null, toMoney(base_value), payment_type || null, deadline || null, req.userId]);

            await ensureDefaultStatuses(db, result.lastID);

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
            const db = await connectDb();
            const projects = await db.all(`
                SELECT 
                    p.*, 
                    clients.name as client_name,
                    tm.role as team_role,
                    CASE 
                        WHEN p.user_id = ? THEN 'owner'
                        WHEN project_members.user_id IS NOT NULL THEN project_members.role
                        WHEN tm.user_id IS NOT NULL THEN tm.role
                        ELSE NULL
                    END as access_role
                FROM projects p
                JOIN clients ON p.client_id = clients.id
                LEFT JOIN project_members 
                    ON project_members.project_id = p.id 
                    AND project_members.user_id = ?
                LEFT JOIN team_members tm
                    ON tm.team_id = COALESCE(p.team_id, clients.team_id)
                    AND tm.user_id = ?
                    AND tm.status = 'active'
                WHERE (
                    (? = 'active' AND p.archived = 0)
                    OR (? = 'archived' AND p.archived = 1)
                    OR ? = 'all'
                )
                  AND (p.user_id = ? OR project_members.user_id IS NOT NULL OR tm.user_id IS NOT NULL)
                ORDER BY p.archived ASC, p.id DESC
            `, [req.userId, req.userId, req.userId, status, status, status, req.userId]);

            return res.json(projects.map(project => {
                const canSeeFinancials = ['owner', 'admin', 'gestor'].includes(project.access_role);
                return {
                    ...project,
                    can_view_financials: canSeeFinancials,
                    base_value: canSeeFinancials ? project.base_value : null,
                    amount_paid: canSeeFinancials ? project.amount_paid : null
                };
            }));
        } catch (error) {
            console.error('[ProjectController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar projetos.' });
        }
    },

    async show(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado.' });

            const canSeeFinancials = await canViewProjectFinancials(db, req.userId, id);
            const expenses = await db.get(`
                SELECT SUM(amount) as total FROM transactions 
                WHERE project_id = ? AND type = 'Despesa' AND user_id = ?
            `, [id, req.userId]);

            const extraExpenses = expenses.total || 0;
            const totalProjectValue = project.base_value + extraExpenses;
            const response = {
                ...project,
                can_view_financials: canSeeFinancials,
                can_edit_financials: await canEditProjectFinancials(db, req.userId, id),
                extra_expenses: canSeeFinancials ? extraExpenses : null,
                total_value: canSeeFinancials ? totalProjectValue : null,
                remaining_balance: canSeeFinancials ? totalProjectValue - project.amount_paid : null
            };

            if (!canSeeFinancials) {
                response.base_value = null;
                response.amount_paid = null;
                response.payment_type = null;
                response.payment_status = null;
                response.financial_notice = 'Voce visualiza apenas sua propria parte financeira neste projeto.';
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
            const { title, description, status, base_value, payment_type, payment_status, amount_paid, deadline } = req.body;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });

            const requestedFields = Object.keys(req.body);
            const canEditFinancials = await canEditProjectFinancials(db, req.userId, id);
            const sensitiveFields = ['base_value', 'payment_type', 'payment_status', 'amount_paid'];
            if (!canEditFinancials && requestedFields.some(field => sensitiveFields.includes(field))) {
                return res.status(403).json({ error: 'Sem permissao para editar valores financeiros do projeto.' });
            }

            if (!['owner', 'admin', 'gestor'].includes(project.access_role) && requestedFields.some(field => field !== 'status')) {
                return res.status(403).json({ error: 'Membros podem alterar apenas o status operacional do projeto.' });
            }

            if (title !== undefined && !isNonEmptyString(title, 160)) {
                return res.status(400).json({ error: 'Titulo invalido.' });
            }

            if (deadline !== undefined && deadline !== null && deadline !== '' && !isDate(deadline)) {
                return res.status(400).json({ error: 'Prazo invalido.' });
            }

            if (base_value !== undefined && !isNonNegativeMoney(base_value)) {
                return res.status(400).json({ error: 'Valor do projeto invalido.' });
            }

            if (amount_paid !== undefined && !isNonNegativeMoney(amount_paid)) {
                return res.status(400).json({ error: 'Valor pago invalido.' });
            }

            if (status) {
                await ensureDefaultStatuses(db, id);
                const statusExists = await db.get(
                    'SELECT id FROM project_statuses WHERE project_id = ? AND LOWER(name) = LOWER(?)',
                    [id, status]
                );

                if (!statusExists) {
                    return res.status(400).json({ error: 'Status invalido para este projeto.' });
                }
            }

            await db.run(`
                UPDATE projects 
                SET title = COALESCE(?, title),
                    description = COALESCE(?, description),
                    status = COALESCE(?, status),
                    base_value = COALESCE(?, base_value),
                    payment_type = COALESCE(?, payment_type),
                    payment_status = COALESCE(?, payment_status),
                    amount_paid = COALESCE(?, amount_paid),
                    deadline = COALESCE(?, deadline)
                WHERE id = ?
            `, [
                title === undefined ? null : title.trim(),
                description === undefined ? null : description,
                status,
                base_value === undefined ? null : toMoney(base_value),
                payment_type,
                payment_status,
                amount_paid === undefined ? null : toMoney(amount_paid),
                deadline === '' ? null : deadline,
                id
            ]);

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
                return res.status(400).json({ error: 'Informe um email valido.' });
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
                return res.status(404).json({ error: 'Usuario nao encontrado.' });
            }

            if (collaborator.id === req.userId) {
                return res.status(400).json({ error: 'Voce ja e o dono deste projeto.' });
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

    async members(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });

            const members = await getProjectMembers(db, id);

            return res.json(members);
        } catch (error) {
            console.error('[ProjectController.members]', error);
            return res.status(500).json({ error: 'Erro ao listar colaboradores.' });
        }
    },

    async statuses(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });

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
            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });

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
                return res.status(400).json({ error: 'Este status ja existe no projeto.' });
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
            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });

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
                return res.status(400).json({ error: 'Escreva uma anotacao.' });
            }

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });

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
            return res.status(500).json({ error: 'Erro ao criar anotacao.' });
        }
    },

    async finance(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });

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
            return res.status(500).json({ error: 'Erro ao carregar divisao financeira.' });
        }
    },

    async updateFinance(req, res) {
        try {
            const { id } = req.params;
            const { total_value, shares } = req.body;
            const db = await connectDb();

            const project = await getProjectAccess(db, id, req.userId);
            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });
            const canEditFinancials = await canEditProjectFinancials(db, req.userId, id);

            if (!canEditFinancials) {
                return res.status(403).json({ error: 'Sem permissao para editar a divisao financeira do projeto.' });
            }

            await ensureFinancialShares(db, id);

            if (total_value !== undefined) {
                if (!isNonNegativeMoney(total_value)) {
                    return res.status(400).json({ error: 'Valor total invalido.' });
                }

                await db.run('UPDATE projects SET base_value = ? WHERE id = ?', [toMoney(total_value), id]);
            }

            if (Array.isArray(shares)) {
                for (const share of shares) {
                    const userId = Number(share.user_id);
                    const amount = toMoney(share.amount);

                    if (!userId || !isNonNegativeMoney(amount)) {
                        return res.status(400).json({ error: 'Participante ou valor invalido.' });
                    }

                    const member = await db.get(`
                        SELECT p.user_id
                        FROM projects p
                        LEFT JOIN project_members pm 
                            ON pm.project_id = p.id AND pm.user_id = ?
                        LEFT JOIN clients c ON c.id = p.client_id
                        LEFT JOIN team_members tm
                            ON tm.team_id = COALESCE(p.team_id, c.team_id)
                            AND tm.user_id = ?
                            AND tm.status = 'active'
                        WHERE p.id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL OR tm.user_id IS NOT NULL)
                    `, [userId, userId, id, userId]);

                    if (!member) {
                        return res.status(400).json({ error: 'Participante invalido para este projeto.' });
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

            return res.json({ message: 'Divisao financeira atualizada.' });
        } catch (error) {
            console.error('[ProjectController.updateFinance]', error);
            return res.status(500).json({ error: 'Erro ao atualizar divisao financeira.' });
        }
    },

    async archive(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const project = await getProjectAccess(db, id, req.userId);

            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });
            if (!['owner', 'admin', 'gestor'].includes(project.access_role)) {
                return res.status(403).json({ error: 'Sem permissao para arquivar este projeto.' });
            }

            await db.run(
                'UPDATE projects SET archived = 1, archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE id = ?',
                [id]
            );
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

            if (!project) return res.status(404).json({ error: 'Projeto nao encontrado ou acesso negado.' });
            if (!['owner', 'admin', 'gestor'].includes(project.access_role)) {
                return res.status(403).json({ error: 'Sem permissao para restaurar este projeto.' });
            }

            await db.run('UPDATE projects SET archived = 0, archived_at = NULL WHERE id = ?', [id]);
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
