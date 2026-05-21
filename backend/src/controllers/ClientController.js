const connectDb = require('../config/database');
const { isEmail, isNonEmptyString, normalizeEmail } = require('../utils/validators');
const {
    canEditClient,
    canEditTeamResource,
    canViewClientSensitiveData,
    canViewProject,
    canViewTeamResource,
    sanitizeClientForRole
} = require('../utils/permissions');
const { logActivity } = require('../utils/activityLog');

async function getClientAccess(db, clientId, userId) {
    const client = await db.get(`
        SELECT c.*, t.name as team_name
        FROM clients c
        LEFT JOIN teams t ON t.id = c.team_id
        WHERE c.id = ?
    `, [clientId]);

    if (!client) return null;

    if (!client.team_id) {
        return client.user_id === userId ? { ...client, can_edit: true, can_view_financials: true } : null;
    }

    const canView = await canViewTeamResource(db, userId, client.team_id);
    if (!canView) return null;

    const canEdit = await canEditClient(db, userId, client);
    return { ...client, can_edit: canEdit, can_view_financials: canEdit };
}

module.exports = {
    async create(req, res) {
        try {
            const { name, contact_name, phone, document, team_id } = req.body;
            const email = req.body.email ? normalizeEmail(req.body.email) : null;
            const userId = req.userId;

            if (!isNonEmptyString(name, 160) || (email && !isEmail(email))) {
                return res.status(400).json({ error: 'Nome do cliente ou email inválido.' });
            }

            const db = await connectDb();

            if (team_id && !await canEditTeamResource(db, userId, team_id)) {
                return res.status(403).json({ error: 'Sem permissão para criar cliente neste time.' });
            }

            const user = await db.get('SELECT plan FROM users WHERE id = ?', [userId]);

            if (!team_id && user.plan === 'free') {
                const count = await db.get(
                    'SELECT COUNT(*) as total FROM clients WHERE user_id = ? AND team_id IS NULL AND archived = 0',
                    [userId]
                );

                if (count.total >= 3) {
                    return res.status(403).json({
                        error: 'Limite de 3 clientes atingido no plano Free. Faça o upgrade para expandir sua carteira!'
                    });
                }
            }

            const result = await db.run(`
                INSERT INTO clients (user_id, team_id, scope, name, contact_name, phone, email, document)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [userId, team_id || null, team_id ? 'team' : 'individual', name.trim(), contact_name || null, phone || null, email, document || null]);

            return res.status(201).json({ id: result.lastID, message: 'Cliente cadastrado com sucesso!' });
        } catch (error) {
            console.error('[ClientController.create]', error);
            return res.status(500).json({ error: 'Erro ao cadastrar cliente.' });
        }
    },

    async index(req, res) {
        try {
            const status = ['active', 'archived', 'all'].includes(req.query.status)
                ? req.query.status
                : 'active';
            const db = await connectDb();
            const clients = await db.all(`
                SELECT c.*, t.name as team_name,
                       CASE WHEN c.team_id IS NULL THEN 'individual' ELSE 'team' END as client_scope,
                       CASE 
                           WHEN c.team_id IS NULL THEN 1
                           WHEN tm.role IN ('owner', 'admin', 'gestor') THEN 1
                           ELSE 0
                       END as can_edit
                FROM clients c
                LEFT JOIN teams t ON t.id = c.team_id
                LEFT JOIN team_members tm 
                    ON tm.team_id = c.team_id 
                    AND tm.user_id = ?
                    AND tm.status = 'active'
                WHERE (
                    (? = 'active' AND c.archived = 0)
                    OR (? = 'archived' AND c.archived = 1)
                    OR ? = 'all'
                )
                  AND ((c.team_id IS NULL AND c.user_id = ?) OR tm.user_id IS NOT NULL)
                ORDER BY c.archived ASC, c.name ASC
            `, [req.userId, status, status, status, req.userId]);

            const sanitizedClients = [];
            for (const client of clients) {
                sanitizedClients.push(sanitizeClientForRole(
                    client,
                    await canViewClientSensitiveData(db, req.userId, client)
                ));
            }

            return res.json(sanitizedClients);
        } catch (error) {
            console.error('[ClientController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar clientes.' });
        }
    },

    async show(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const client = await getClientAccess(db, id, req.userId);

            if (!client) {
                return res.status(404).json({ error: 'Cliente não encontrado ou acesso negado.' });
            }

            return res.json(sanitizeClientForRole(
                client,
                await canViewClientSensitiveData(db, req.userId, client)
            ));
        } catch (error) {
            console.error('[ClientController.show]', error);
            return res.status(500).json({ error: 'Erro ao buscar detalhes do cliente.' });
        }
    },

    async projects(req, res) {
        try {
            const { id } = req.params;
            const { include_archived } = req.query;
            const db = await connectDb();
            const client = await getClientAccess(db, id, req.userId);

            if (!client) {
                return res.status(404).json({ error: 'Cliente não encontrado ou acesso negado.' });
            }

            const projects = await db.all(`
                SELECT p.id, p.title, p.status, p.base_value, p.deadline, p.archived, p.archived_at, p.team_id,
                       CASE WHEN p.user_id = ? THEN 1 ELSE 0 END as is_owner
                FROM projects p
                WHERE p.client_id = ?
                  AND (? = 'true' OR p.archived = 0)
                ORDER BY p.archived ASC, p.id DESC
            `, [req.userId, id, include_archived === 'true' ? 'true' : 'false']);

            const visibleProjects = [];
            for (const project of projects) {
                if (!await canViewProject(db, req.userId, project.id)) continue;
                const canSeeValues = !client.team_id || client.can_view_financials;
                visibleProjects.push({
                    ...project,
                    base_value: canSeeValues ? project.base_value : null,
                    can_view_financials: canSeeValues
                });
            }

            return res.json(visibleProjects);
        } catch (error) {
            console.error('[ClientController.projects]', error);
            return res.status(500).json({ error: 'Erro ao buscar projetos do cliente.' });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const { name, contact_name, phone, document, team_id } = req.body;
            const email = req.body.email ? normalizeEmail(req.body.email) : req.body.email;
            const db = await connectDb();

            const client = await getClientAccess(db, id, req.userId);
            if (!client || !client.can_edit) {
                return res.status(403).json({ error: 'Sem permissão para editar este cliente.' });
            }

            if (team_id !== undefined && team_id && !await canEditTeamResource(db, req.userId, team_id)) {
                return res.status(403).json({ error: 'Sem permissão para mover cliente para este time.' });
            }

            if (name !== undefined && !isNonEmptyString(name, 160)) {
                return res.status(400).json({ error: 'Nome do cliente inválido.' });
            }

            if (email && !isEmail(email)) {
                return res.status(400).json({ error: 'Email inválido.' });
            }

            const nextTeamId = team_id === undefined ? null : team_id || null;
            const nextScope = team_id === undefined ? null : team_id ? 'team' : 'individual';

            await db.run(`
                UPDATE clients 
                SET name = COALESCE(?, name),
                    contact_name = COALESCE(?, contact_name),
                    phone = COALESCE(?, phone),
                    email = COALESCE(?, email),
                    document = COALESCE(?, document),
                    team_id = COALESCE(?, team_id),
                    scope = COALESCE(?, scope)
                WHERE id = ?
            `, [name === undefined ? null : name.trim(), contact_name, phone, email, document, nextTeamId, nextScope, id]);

            if (team_id !== undefined) {
                await db.run(
                    'UPDATE clients SET team_id = ?, scope = ? WHERE id = ?',
                    [team_id || null, team_id ? 'team' : 'individual', id]
                );
            }

            return res.json({ message: 'Dados do cliente atualizados.' });
        } catch (error) {
            console.error('[ClientController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar cliente.' });
        }
    },

    async archive(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const client = await getClientAccess(db, id, req.userId);

            if (!client || !client.can_edit) {
                return res.status(403).json({ error: 'Sem permissão para arquivar este cliente.' });
            }

            await db.run('UPDATE clients SET archived = 1 WHERE id = ?', [id]);
            await logActivity(db, req.userId, 'archive', 'client', id);
            return res.json({ message: 'Cliente arquivado com sucesso.' });
        } catch (error) {
            console.error('[ClientController.archive]', error);
            return res.status(500).json({ error: 'Erro ao arquivar cliente.' });
        }
    },

    async restore(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const client = await getClientAccess(db, id, req.userId);

            if (!client || !client.can_edit) {
                return res.status(403).json({ error: 'Sem permissão para restaurar este cliente.' });
            }

            await db.run('UPDATE clients SET archived = 0 WHERE id = ?', [id]);
            await logActivity(db, req.userId, 'restore', 'client', id);
            return res.json({ message: 'Cliente restaurado com sucesso.' });
        } catch (error) {
            console.error('[ClientController.restore]', error);
            return res.status(500).json({ error: 'Erro ao restaurar cliente.' });
        }
    },

    async destroy(req, res) {
        return module.exports.archive(req, res);
    }
};
