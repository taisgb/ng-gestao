const connectDb = require('../config/database');
const { isEmail, isNonEmptyString, normalizeEmail } = require('../utils/validators');
const { TEAM_ROLES, canManageTeam, canManageTeamMembers, getTeamRole, isTeamMember } = require('../utils/permissions');

module.exports = {
    async index(req, res) {
        try {
            const db = await connectDb();
            const teams = await db.all(`
                SELECT t.*, tm.role as my_role
                FROM teams t
                JOIN team_members tm ON tm.team_id = t.id
                WHERE tm.user_id = ? AND tm.status = 'active' AND t.archived = 0
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
                return res.status(400).json({ error: 'Nome do time e obrigatorio.' });
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

            if (!role) return res.status(404).json({ error: 'Time nao encontrado ou acesso negado.' });

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

            if (!await canManageTeam(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissao para editar este time.' });
            }

            if (name !== undefined && !isNonEmptyString(name, 120)) {
                return res.status(400).json({ error: 'Nome invalido.' });
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
            const role = await getTeamRole(db, req.userId, id);

            if (role !== 'owner') {
                return res.status(403).json({ error: 'Apenas owner pode arquivar o time.' });
            }

            await db.run('UPDATE teams SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
            return res.json({ message: 'Time arquivado.' });
        } catch (error) {
            console.error('[TeamController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao arquivar time.' });
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
                ORDER BY CASE tm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'gestor' THEN 3 ELSE 4 END, tm.email ASC
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

            if (!await canManageTeamMembers(db, req.userId, id)) {
                return res.status(403).json({ error: 'Sem permissao para gerenciar membros.' });
            }

            if (!isEmail(email) || !TEAM_ROLES.includes(role) || role === 'owner') {
                return res.status(400).json({ error: 'Email ou papel invalido.' });
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
                return res.status(403).json({ error: 'Sem permissao para gerenciar membros.' });
            }

            const member = await db.get('SELECT * FROM team_members WHERE id = ? AND team_id = ?', [memberId, id]);
            if (!member) return res.status(404).json({ error: 'Membro nao encontrado.' });
            if (member.role === 'owner') return res.status(403).json({ error: 'Nao e permitido alterar owner por aqui.' });

            if (role !== undefined && (!TEAM_ROLES.includes(role) || role === 'owner')) {
                return res.status(400).json({ error: 'Papel invalido.' });
            }

            await db.run(`
                UPDATE team_members
                SET role = COALESCE(?, role),
                    status = COALESCE(?, status),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND team_id = ?
            `, [role, status, memberId, id]);

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
                return res.status(403).json({ error: 'Sem permissao para remover membros.' });
            }

            const member = await db.get('SELECT * FROM team_members WHERE id = ? AND team_id = ?', [memberId, id]);
            if (!member) return res.status(404).json({ error: 'Membro nao encontrado.' });
            if (member.role === 'owner') return res.status(403).json({ error: 'Nao e permitido remover owner.' });

            await db.run("UPDATE team_members SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [memberId]);
            return res.json({ message: 'Membro removido.' });
        } catch (error) {
            console.error('[TeamController.removeMember]', error);
            return res.status(500).json({ error: 'Erro ao remover membro.' });
        }
    }
};
