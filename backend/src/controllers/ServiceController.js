const connectDb = require('../config/database');
const { isNonEmptyString, isNonNegativeMoney, toMoney } = require('../utils/validators');
const { canEditTeamResource, canViewTeamResource } = require('../utils/permissions');

async function getServiceAccess(db, serviceId, userId) {
    const service = await db.get(`
        SELECT s.*,
               t.name as team_name,
               COALESCE(s.default_value, s.default_price, 0) as default_value,
               COALESCE(s.default_price, s.default_value, 0) as default_price,
               CASE WHEN s.archived = 1 OR s.active = 0 THEN 1 ELSE 0 END as archived
        FROM services s
        LEFT JOIN teams t ON t.id = s.team_id
        WHERE s.id = ?
    `, [serviceId]);

    if (!service) return null;

    if (!service.team_id) {
        return service.user_id === userId ? { ...service, can_edit: true } : null;
    }

    if (!await canViewTeamResource(db, userId, service.team_id)) return null;
    return { ...service, can_edit: await canEditTeamResource(db, userId, service.team_id) };
}

function getMoneyValue(body) {
    return body.default_value !== undefined ? body.default_value : body.default_price;
}

module.exports = {
    async create(req, res) {
        try {
            const { name, description, team_id } = req.body;
            const defaultValue = getMoneyValue(req.body);

            if (!isNonEmptyString(name, 100)) {
                return res.status(400).json({ error: 'Informe o nome do servico.' });
            }

            if (defaultValue !== undefined && !isNonNegativeMoney(defaultValue)) {
                return res.status(400).json({ error: 'Valor padrao invalido.' });
            }

            const db = await connectDb();
            if (team_id && !await canEditTeamResource(db, req.userId, team_id)) {
                return res.status(403).json({ error: 'Sem permissao para criar servicos neste time.' });
            }

            const money = toMoney(defaultValue);
            const result = await db.run(`
                INSERT INTO services (
                    user_id, team_id, scope, name, default_price, default_value, description, active, archived, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP)
            `, [
                req.userId,
                team_id || null,
                team_id ? 'team' : 'individual',
                name.trim(),
                money,
                money,
                description || null
            ]);

            return res.status(201).json({ id: result.lastID, message: 'Servico cadastrado.' });
        } catch (error) {
            console.error('[ServiceController.create]', error);
            return res.status(500).json({ error: 'Erro ao cadastrar servico.' });
        }
    },

    async index(req, res) {
        try {
            const status = ['active', 'archived', 'all'].includes(req.query.status)
                ? req.query.status
                : 'active';
            const db = await connectDb();
            const services = await db.all(`
                SELECT s.*,
                       t.name as team_name,
                       CASE WHEN s.team_id IS NULL THEN 'individual' ELSE 'team' END as service_scope,
                       COALESCE(s.default_value, s.default_price, 0) as default_value,
                       COALESCE(s.default_price, s.default_value, 0) as default_price,
                       CASE WHEN s.archived = 1 OR s.active = 0 THEN 1 ELSE 0 END as archived,
                       CASE
                           WHEN s.team_id IS NULL THEN 1
                           WHEN tm.role IN ('owner', 'admin', 'gestor') THEN 1
                           ELSE 0
                       END as can_edit
                FROM services s
                LEFT JOIN teams t ON t.id = s.team_id
                LEFT JOIN team_members tm
                    ON tm.team_id = s.team_id
                    AND tm.user_id = ?
                    AND tm.status = 'active'
                WHERE (
                    (? = 'active' AND COALESCE(s.archived, 0) = 0 AND COALESCE(s.active, 1) = 1)
                    OR (? = 'archived' AND (COALESCE(s.archived, 0) = 1 OR COALESCE(s.active, 1) = 0))
                    OR ? = 'all'
                )
                  AND ((s.team_id IS NULL AND s.user_id = ?) OR tm.user_id IS NOT NULL)
                ORDER BY CASE WHEN s.archived = 1 OR s.active = 0 THEN 1 ELSE 0 END ASC, s.name ASC
            `, [req.userId, status, status, status, req.userId]);

            return res.json(services);
        } catch (error) {
            console.error('[ServiceController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar servicos.' });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const { name, description, team_id } = req.body;
            const defaultValue = getMoneyValue(req.body);
            const db = await connectDb();
            const service = await getServiceAccess(db, id, req.userId);

            if (!service || !service.can_edit) {
                return res.status(403).json({ error: 'Sem permissao para editar este servico.' });
            }

            if (name !== undefined && !isNonEmptyString(name, 100)) {
                return res.status(400).json({ error: 'Nome invalido.' });
            }

            if (defaultValue !== undefined && !isNonNegativeMoney(defaultValue)) {
                return res.status(400).json({ error: 'Valor padrao invalido.' });
            }

            if (team_id && !await canEditTeamResource(db, req.userId, team_id)) {
                return res.status(403).json({ error: 'Sem permissao para mover servico para este time.' });
            }

            const nextTeamId = team_id === undefined ? service.team_id : team_id || null;
            const nextScope = team_id === undefined ? service.scope : team_id ? 'team' : 'individual';
            const money = defaultValue === undefined ? null : toMoney(defaultValue);

            const result = await db.run(`
                UPDATE services
                SET name = COALESCE(?, name),
                    default_price = COALESCE(?, default_price),
                    default_value = COALESCE(?, default_value),
                    description = COALESCE(?, description),
                    team_id = ?,
                    scope = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                name === undefined ? null : name.trim(),
                money,
                money,
                description === undefined ? null : description,
                nextTeamId,
                nextScope,
                id
            ]);

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Servico nao encontrado.' });
            }

            return res.json({ message: 'Servico atualizado.' });
        } catch (error) {
            console.error('[ServiceController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar servico.' });
        }
    },

    async archive(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const service = await getServiceAccess(db, id, req.userId);

            if (!service || !service.can_edit) {
                return res.status(403).json({ error: 'Sem permissao para arquivar este servico.' });
            }

            const result = await db.run(
                'UPDATE services SET archived = 1, active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [id]
            );

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Servico nao encontrado.' });
            }

            return res.json({ message: 'Servico arquivado.' });
        } catch (error) {
            console.error('[ServiceController.archive]', error);
            return res.status(500).json({ error: 'Erro ao arquivar servico.' });
        }
    },

    async restore(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const service = await getServiceAccess(db, id, req.userId);

            if (!service || !service.can_edit) {
                return res.status(403).json({ error: 'Sem permissao para restaurar este servico.' });
            }

            const result = await db.run(
                'UPDATE services SET archived = 0, active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [id]
            );

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Servico nao encontrado.' });
            }

            return res.json({ message: 'Servico restaurado com sucesso.' });
        } catch (error) {
            console.error('[ServiceController.restore]', error);
            return res.status(500).json({ error: 'Erro ao restaurar servico.' });
        }
    },

    async destroy(req, res) {
        return module.exports.archive(req, res);
    }
};
