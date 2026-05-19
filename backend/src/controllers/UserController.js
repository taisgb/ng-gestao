const bcrypt = require('bcryptjs');
const connectDb = require('../config/database');
const { isEmail, isNonEmptyString, normalizeEmail } = require('../utils/validators');

const ALLOWED_PLANS = ['free', 'pro', 'admin', 'convidado'];

async function getAdminUser(db, userId) {
    return db.get('SELECT plan FROM users WHERE id = ?', [userId]);
}

async function ensureAdmin(db, userId) {
    const admin = await getAdminUser(db, userId);

    if (!admin || admin.plan !== 'admin') {
        return false;
    }

    return true;
}

module.exports = {
    async store(req, res) {
        try {
            const { name, password } = req.body;
            const email = normalizeEmail(req.body.email);

            if (!isNonEmptyString(name, 120) || !isEmail(email) || !isNonEmptyString(password, 128) || password.length < 8) {
                return res.status(400).json({ error: 'Informe nome, email valido e senha com pelo menos 8 caracteres.' });
            }

            const db = await connectDb();

            const userExists = await db.get('SELECT id FROM users WHERE email = ?', [email]);
            if (userExists) {
                return res.status(400).json({ error: 'Este email ja esta em uso.' });
            }

            const usersCount = await db.get('SELECT COUNT(*) as total FROM users');
            let plan = 'admin';
            let invitation = null;

            if (usersCount.total > 0) {
                invitation = await db.get(
                    'SELECT * FROM invitations WHERE email = ? AND accepted_at IS NULL',
                    [email]
                );

                if (!invitation) {
                    return res.status(403).json({ error: 'Cadastro disponivel apenas para emails convidados.' });
                }

                plan = ALLOWED_PLANS.includes(invitation.plan) ? invitation.plan : 'convidado';
            }

            const password_hash = await bcrypt.hash(password, 10);

            const result = await db.run(`
                INSERT INTO users (name, email, password, plan)
                VALUES (?, ?, ?, ?)
            `, [name.trim(), email, password_hash, plan]);

            if (invitation) {
                await db.run('UPDATE invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = ?', [invitation.id]);
            }

            return res.status(201).json({
                id: result.lastID,
                name: name.trim(),
                email,
                plan
            });
        } catch (error) {
            console.error('[UserController.store]', error);
            return res.status(500).json({ error: 'Erro ao criar conta.' });
        }
    },

    async show(req, res) {
        try {
            const db = await connectDb();
            const user = await db.get(
                'SELECT id, name, email, plan, role_title, location, bio, created_at FROM users WHERE id = ?',
                [req.userId]
            );

            if (!user) {
                return res.status(404).json({ error: 'Utilizador nao encontrado.' });
            }

            return res.json(user);
        } catch (error) {
            console.error('[UserController.show]', error);
            return res.status(500).json({ error: 'Erro ao buscar perfil.' });
        }
    },

    async update(req, res) {
        try {
            const { name, password, role_title, location, bio } = req.body;
            const email = req.body.email === undefined ? undefined : normalizeEmail(req.body.email);

            if (name !== undefined && !isNonEmptyString(name, 120)) {
                return res.status(400).json({ error: 'Nome invalido.' });
            }

            if (email !== undefined && !isEmail(email)) {
                return res.status(400).json({ error: 'Email invalido.' });
            }

            if (password !== undefined && (!isNonEmptyString(password, 128) || password.length < 8)) {
                return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
            }

            if (role_title !== undefined && role_title !== '' && !isNonEmptyString(role_title, 120)) {
                return res.status(400).json({ error: 'Funcao invalida.' });
            }

            const db = await connectDb();

            if (email !== undefined) {
                const existing = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.userId]);
                if (existing) {
                    return res.status(400).json({ error: 'Este email ja esta em uso.' });
                }
            }

            const passwordHash = password ? await bcrypt.hash(password, 10) : null;

            await db.run(`
                UPDATE users
                SET name = COALESCE(?, name),
                    email = COALESCE(?, email),
                    password = COALESCE(?, password),
                    role_title = COALESCE(?, role_title),
                    location = COALESCE(?, location),
                    bio = COALESCE(?, bio)
                WHERE id = ?
            `, [
                name === undefined ? null : name.trim(),
                email === undefined ? null : email,
                passwordHash,
                role_title === undefined ? null : role_title.trim(),
                location === undefined ? null : location,
                bio === undefined ? null : bio,
                req.userId
            ]);

            const user = await db.get('SELECT id, name, email, plan, role_title, location, bio, created_at FROM users WHERE id = ?', [req.userId]);

            return res.json(user);
        } catch (error) {
            console.error('[UserController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar perfil.' });
        }
    },

    async promote(req, res) {
        try {
            const email = normalizeEmail(req.body.email);
            const { newPlan } = req.body;

            if (!isEmail(email) || !ALLOWED_PLANS.includes(newPlan)) {
                return res.status(400).json({ error: 'Email ou plano invalido.' });
            }

            const db = await connectDb();
            const isAdmin = await ensureAdmin(db, req.userId);

            if (!isAdmin) {
                return res.status(403).json({ error: 'Apenas administradores podem alterar planos.' });
            }

            const result = await db.run(
                'UPDATE users SET plan = ? WHERE email = ?',
                [newPlan, email]
            );

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Utilizador nao encontrado.' });
            }

            return res.json({ message: `Plano do utilizador ${email} atualizado para ${newPlan}.` });
        } catch (error) {
            console.error('[UserController.promote]', error);
            return res.status(500).json({ error: 'Erro ao atualizar plano.' });
        }
    },

    async listUsers(req, res) {
        try {
            const db = await connectDb();
            const isAdmin = await ensureAdmin(db, req.userId);

            if (!isAdmin) {
                return res.status(403).json({ error: 'Apenas administradores podem listar usuarios.' });
            }

            const users = await db.all(`
                SELECT id, name, email, plan, role_title, location, bio, created_at
                FROM users
                ORDER BY created_at DESC, name ASC
            `);

            return res.json(users);
        } catch (error) {
            console.error('[UserController.listUsers]', error);
            return res.status(500).json({ error: 'Erro ao listar usuarios.' });
        }
    },

    async createInvitation(req, res) {
        try {
            const email = normalizeEmail(req.body.email);
            const plan = req.body.plan || 'convidado';

            if (!isEmail(email) || !ALLOWED_PLANS.includes(plan)) {
                return res.status(400).json({ error: 'Email ou categoria invalida.' });
            }

            const db = await connectDb();
            const isAdmin = await ensureAdmin(db, req.userId);

            if (!isAdmin) {
                return res.status(403).json({ error: 'Apenas administradores podem convidar usuarios.' });
            }

            const userExists = await db.get('SELECT id FROM users WHERE email = ?', [email]);
            if (userExists) {
                return res.status(400).json({ error: 'Este usuario ja possui conta.' });
            }

            const result = await db.run(`
                INSERT INTO invitations (email, plan, invited_by)
                VALUES (?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET
                    plan = excluded.plan,
                    invited_by = excluded.invited_by,
                    accepted_at = NULL,
                    created_at = CURRENT_TIMESTAMP
            `, [email, plan, req.userId]);

            return res.status(201).json({ id: result.lastID, email, plan, message: 'Convite registrado.' });
        } catch (error) {
            console.error('[UserController.createInvitation]', error);
            return res.status(500).json({ error: 'Erro ao registrar convite.' });
        }
    },

    async listInvitations(req, res) {
        try {
            const db = await connectDb();
            const isAdmin = await ensureAdmin(db, req.userId);

            if (!isAdmin) {
                return res.status(403).json({ error: 'Apenas administradores podem listar convites.' });
            }

            const invitations = await db.all(`
                SELECT i.*, u.name as invited_by_name
                FROM invitations i
                JOIN users u ON u.id = i.invited_by
                ORDER BY i.accepted_at ASC, i.created_at DESC
            `);

            return res.json(invitations);
        } catch (error) {
            console.error('[UserController.listInvitations]', error);
            return res.status(500).json({ error: 'Erro ao listar convites.' });
        }
    }
};
