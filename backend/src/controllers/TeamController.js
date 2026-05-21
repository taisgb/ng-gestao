const connectDb = require('../config/database');
const { isEmail, isNonEmptyString, normalizeEmail } = require('../utils/validators');
const {
    TEAM_ROLES,
    canArchiveTeam,
    canChangeTeamRole,
    canEditTeam,
    canInviteTeamMember,
    canManageTeamMembers,
    getTeamRole,
    isTeamMember
} = require('../utils/permissions');
const { logActivity } = require('../utils/activityLog');

module.exports = {
    async index(req, res) {
        try {
            const db = await connectDb();
            const status = ['active', 'archived', 'all'].includes(req.query.status)
                ? req.query.status
                : 'active';
            const statusWhere = {
                active: 'AND COALESCE(t.archived, 0) = 0',
                archived: 'AND COALESCE(t.archived, 0) = 1',
                all: ''
            }[status];
            const teams = await db.all(`
                SELECT t.*, tm.role as my_role
                FROM teams t
                JOIN team_members tm ON tm.team_id = t.id
                WHERE tm.user_id = ?
                  AND tm.status = 'active'
                  ${statusWhere}
                ORDER BY t.created_at DESC
            `, [req.userId]);

            return res.json(teams);
        } catch (error) {
            console.error('[TeamController.index]', error);
            return res.status(500).json({ error: 'Erro ao listar times.' });
        }
    },

    async create(req, res) {
        try {
            const { name, description } = req.body;
            if (!isNonEmptyString(name, 120)) {
                return res.status(400).json({ error: 'Nome do time é obrigatório.' });
            }

            const db = await connectDb();
            const result = await db.run(`
                INSERT INTO teams (name, description, owner_id)
                VALUES (?, ?, ?)
            `, [name.trim(), description || null, req.userId]);

            const user = await db.get('SELECT email FROM users WHERE id = ?', [req.userId]);
            await db.run(`
                INSERT INTO team_members (team_id, user_id, email, role, status)
                VALUES (?, ?, ?, 'owner', 'active')
            `, [result.lastID, req.userId, user.email]);

            return res.status(201).json({ id: result.lastID, message: 'Time criado.' });
        } catch (error) {
            console.error('[TeamController.create]', error);
            return res.status(500).json({ error: 'Erro ao criar time.' });
        }
    },

    async show(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const role = await getTeamRole(db, req.userId, id);

            if (!role) return res.status(404).json({ error: 'Time não encontrado ou acesso negado.' });

            const team = await db.get('SELECT * FROM teams WHERE id = ? AND archived = 0', [id]);
            return res.json({ ...team, my_role: role });
        } catch (error) {
            console.error('[TeamController.show]', error);
            return res.status(500).json({ error: 'Erro ao buscar time.' });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const { name, description } = req.body;
            const db = await connectDb();

            if (!await canEditTeam(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissão para editar este time.' });
            }

            if (name !== undefined && !isNonEmptyString(name, 120)) {
                return res.status(400).json({ error: 'Nome inválido.' });
            }

            await db.run(`
                UPDATE teams
                SET name = COALESCE(?, name),
                    description = COALESCE(?, description),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [name === undefined ? null : name.trim(), description, id]);

            return res.json({ message: 'Time atualizado.' });
        } catch (error) {
            console.error('[TeamController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar time.' });
        }
    },

    async destroy(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            if (!await canManageTeamMembers(db, req.userId, id)) {
                return res.status(403).json({ error: 'Apenas owner/admin podem excluir o time.' });
            }

            const team = await db.get('SELECT * FROM teams WHERE id = ?', [id]);
            if (!team) return res.status(404).json({ error: 'Time não encontrado.' });

            const activeProjects = await db.get(
                'SELECT COUNT(*) as total FROM projects WHERE team_id = ? AND COALESCE(archived, 0) = 0',
                [id]
            );
            const activeMembers = await db.get(`
                SELECT COUNT(*) as total
                FROM team_members
                WHERE team_id = ?
                  AND status = 'active'
                  AND role != 'owner'
            `, [id]);
            const pendingFinancial = await db.get(`
                SELECT COUNT(*) as total
                FROM project_financial_entries
                WHERE team_id = ?
                  AND COALESCE(archived, 0) = 0
                  AND status IN ('pending', 'expected')
            `, [id]);

            const blockers = {
                active_projects: Number(activeProjects.total || 0),
                active_members: Number(activeMembers.total || 0),
                pending_financial_entries: Number(pendingFinancial.total || 0)
            };

            if (blockers.active_projects || blockers.active_members || blockers.pending_financial_entries) {
                return res.status(409).json({
                    error: 'Não é possível excluir este time com projetos ativos, membros ativos ou financeiro pendente. Arquive o time ou resolva as pendências primeiro.',
                    blockers
                });
            }

            await db.run("UPDATE projects SET team_id = NULL, scope = 'individual' WHERE team_id = ?", [id]);
            await db.run("UPDATE clients SET team_id = NULL, scope = 'individual' WHERE team_id = ?", [id]);
            await db.run("UPDATE services SET team_id = NULL, scope = 'individual' WHERE team_id = ?", [id]);
            await db.run("UPDATE tasks SET team_id = NULL, scope = 'individual' WHERE team_id = ?", [id]);
            await db.run('UPDATE documents SET team_id = NULL WHERE team_id = ?', [id]);
            await db.run('UPDATE personal_transactions SET team_id = NULL WHERE team_id = ?', [id]);
            await db.run('UPDATE project_financial_entries SET team_id = NULL WHERE team_id = ?', [id]);
            await db.run('DELETE FROM team_invites WHERE team_id = ?', [id]);
            await db.run('DELETE FROM team_members WHERE team_id = ?', [id]);
            await db.run('DELETE FROM teams WHERE id = ?', [id]);

            await logActivity(db, req.userId, 'delete', 'team', id, { blockers });
            return res.json({ message: 'Time excluído.' });
        } catch (error) {
            console.error('[TeamController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao excluir time.' });
        }
    },

    async archive(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const role = await getTeamRole(db, req.userId, id);

            if (!await canArchiveTeam(db, req.userId, id)) {
                return res.status(403).json({ error: 'Apenas owner pode arquivar o time.' });
            }

            await db.run('UPDATE teams SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
            await logActivity(db, req.userId, 'archive', 'team', id);
            return res.json({ message: 'Time arquivado.' });
        } catch (error) {
            console.error('[TeamController.archive]', error);
            return res.status(500).json({ error: 'Erro ao arquivar time.' });
        }
    },

    async restore(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const role = await getTeamRole(db, req.userId, id);

            if (!await canArchiveTeam(db, req.userId, id)) {
                return res.status(403).json({ error: 'Apenas owner pode restaurar o time.' });
            }

            await db.run('UPDATE teams SET archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
            await logActivity(db, req.userId, 'restore', 'team', id);
            return res.json({ message: 'Time restaurado.' });
        } catch (error) {
            console.error('[TeamController.restore]', error);
            return res.status(500).json({ error: 'Erro ao restaurar time.' });
        }
    },

    async members(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            if (!await isTeamMember(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem acesso a este time.' });
            }

            const members = await db.all(`
                SELECT tm.*, u.name
                FROM team_members tm
                LEFT JOIN users u ON u.id = tm.user_id
                WHERE tm.team_id = ? AND tm.status != 'removed'
                ORDER BY CASE tm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'gestor' THEN 3 WHEN 'financeiro' THEN 4 ELSE 5 END, tm.email ASC
            `, [id]);

            return res.json(members);
        } catch (error) {
            console.error('[TeamController.members]', error);
            return res.status(500).json({ error: 'Erro ao listar membros.' });
        }
    },

    async addMember(req, res) {
        try {
            const { id } = req.params;
            const email = normalizeEmail(req.body.email);
            const role = req.body.role || 'member';
            const db = await connectDb();

            if (!await canInviteTeamMember(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissão para gerenciar membros.' });
            }

            if (!isEmail(email) || !TEAM_ROLES.includes(role) || role === 'owner') {
                return res.status(400).json({ error: 'Email ou papel inválido.' });
            }

            const user = await db.get('SELECT id FROM users WHERE email = ?', [email]);
            const status = user ? 'active' : 'pending';

            await db.run(`
                INSERT INTO team_members (team_id, user_id, email, role, status, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(team_id, email) DO UPDATE SET
                    user_id = excluded.user_id,
                    role = excluded.role,
                    status = excluded.status,
                    updated_at = CURRENT_TIMESTAMP
            `, [id, user?.id || null, email, role, status]);

            if (!user) {
                await db.run(`
                    INSERT INTO team_invites (team_id, email, invited_by, status)
                    VALUES (?, ?, ?, 'pending')
                    ON CONFLICT(team_id, email) DO UPDATE SET
                        invited_by = excluded.invited_by,
                        status = 'pending',
                        accepted_at = NULL
                `, [id, email, req.userId]);
            }

            await logActivity(db, req.userId, 'invite_member', 'team', id, { email, role, status });
            return res.status(201).json({ message: user ? 'Membro adicionado.' : 'Convite pendente registrado.' });
        } catch (error) {
            console.error('[TeamController.addMember]', error);
            return res.status(500).json({ error: 'Erro ao adicionar membro.' });
        }
    },

    async updateMember(req, res) {
        try {
            const { id, memberId } = req.params;
            const { role, status } = req.body;
            const db = await connectDb();

            if (!await canManageTeamMembers(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissão para gerenciar membros.' });
            }

            const member = await db.get('SELECT * FROM team_members WHERE id = ? AND team_id = ?', [memberId, id]);
            if (!member) return res.status(404).json({ error: 'Membro não encontrado.' });
            if (member.role === 'owner') return res.status(403).json({ error: 'Não é permitido alterar o dono por aqui.' });

            if (role !== undefined && !await canChangeTeamRole(db, req.userId, id, role)) {
                return res.status(403).json({ error: 'Sem permissão para alterar para este papel.' });
            }

            if (role !== undefined && (!TEAM_ROLES.includes(role) || role === 'owner')) {
                return res.status(400).json({ error: 'Papel inválido.' });
            }

            await db.run(`
                UPDATE team_members
                SET role = COALESCE(?, role),
                    status = COALESCE(?, status),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND team_id = ?
            `, [role, status, memberId, id]);

            await logActivity(db, req.userId, 'change_member_role', 'team', id, { member_id: memberId, role, status });
            return res.json({ message: 'Membro atualizado.' });
        } catch (error) {
            console.error('[TeamController.updateMember]', error);
            return res.status(500).json({ error: 'Erro ao atualizar membro.' });
        }
    },

    async removeMember(req, res) {
        try {
            const { id, memberId } = req.params;
            const db = await connectDb();

            if (!await canManageTeamMembers(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissão para remover membros.' });
            }

            const member = await db.get('SELECT * FROM team_members WHERE id = ? AND team_id = ?', [memberId, id]);
            if (!member) return res.status(404).json({ error: 'Membro não encontrado.' });
            if (member.role === 'owner') return res.status(403).json({ error: 'Não é permitido remover o dono.' });

            if (member.user_id) {
                const ownedProjects = await db.get(`
                    SELECT COUNT(*) as total
                    FROM projects
                    WHERE team_id = ?
                      AND user_id = ?
                      AND COALESCE(archived, 0) = 0
                `, [id, member.user_id]);

                if (Number(ownedProjects.total || 0) > 0) {
                    return res.status(409).json({ error: 'Este membro e dono de projeto ativo do time. Transfira o projeto antes de remover.' });
                }

                await db.run(`
                    DELETE FROM project_members
                    WHERE user_id = ?
                      AND project_id IN (SELECT id FROM projects WHERE team_id = ?)
                `, [member.user_id, id]);

                await db.run(`
                    UPDATE tasks
                    SET assigned_to = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE team_id = ?
                      AND assigned_to = ?
                `, [id, member.user_id]);
            }

            await db.run("UPDATE team_members SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [memberId]);
            await logActivity(db, req.userId, 'remove_member', 'team', id, { member_id: memberId });
            return res.json({ message: 'Membro removido.' });
        } catch (error) {
            console.error('[TeamController.removeMember]', error);
            return res.status(500).json({ error: 'Erro ao remover membro.' });
        }
    }
};
