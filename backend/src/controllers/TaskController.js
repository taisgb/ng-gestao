const connectDb = require('../config/database');
const { isDate, isNonEmptyString } = require('../utils/validators');
const { canEditTeamResource, getProjectAccess, getTeamRole } = require('../utils/permissions');

async function canAccessProject(db, projectId, userId) {
    return getProjectAccess(db, userId, projectId);
}

async function canAccessTask(db, taskId, userId, requireEdit = false) {
    const task = await db.get(`
        SELECT t.*, p.team_id as project_team_id, p.scope as project_scope
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.id = ?
    `, [taskId]);

    if (!task) return null;
    if (task.user_id === userId) return task;

    if (task.project_id) {
        const projectAccess = await getProjectAccess(db, userId, task.project_id);
        if (!projectAccess) return null;
        if (requireEdit && !['owner', 'admin', 'gestor'].includes(projectAccess.access_role)) return null;
        return task;
    }

    const teamId = task.team_id || (task.project_scope === 'team' ? task.project_team_id : null);
    if (!teamId) return null;
    const role = await getTeamRole(db, userId, teamId);
    if (!role) return null;
    if (requireEdit && !['owner', 'admin', 'gestor'].includes(role)) return null;
    return task;
}

module.exports = {
    async index(req, res) {
        try {
            const { project_id } = req.query;
            const db = await connectDb();

            if (project_id) {
                const project = await canAccessProject(db, project_id, req.userId);
                if (!project) {
                    return res.status(403).json({ error: 'Voce nao tem acesso a este projeto.' });
                }

                const tasks = await db.all(`
                    SELECT * FROM tasks
                    WHERE project_id = ?
                    ORDER BY status DESC, due_date ASC
                `, [project_id]);

                return res.json(tasks);
            }

            const tasks = await db.all(`
                SELECT t.*, p.title as project_title, teams.name as team_name
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN teams ON teams.id = COALESCE(t.team_id, p.team_id)
                LEFT JOIN team_members tm
                    ON tm.team_id = COALESCE(t.team_id, p.team_id)
                    AND tm.user_id = ?
                    AND tm.status = 'active'
                LEFT JOIN project_members pm
                    ON pm.project_id = t.project_id
                    AND pm.user_id = ?
                WHERE t.user_id = ?
                   OR (t.project_id IS NULL AND tm.user_id IS NOT NULL)
                   OR pm.user_id IS NOT NULL
                   OR (p.scope = 'team' AND tm.role IN ('owner', 'admin', 'gestor'))
                ORDER BY t.due_date ASC, t.id ASC
            `, [req.userId, req.userId, req.userId]);

            return res.json(tasks);
        } catch (error) {
            console.error('[TaskController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar tarefas.' });
        }
    },

    async create(req, res) {
        try {
            const { project_id, team_id, title, task_type, due_date } = req.body;
            const userId = req.userId;

            if (!isNonEmptyString(title, 160) || !isDate(due_date)) {
                return res.status(400).json({ error: 'Titulo e data de vencimento valida sao obrigatorios.' });
            }

            const db = await connectDb();

            let taskTeamId = team_id || null;
            if (project_id) {
                const projectCheck = await canAccessProject(db, project_id, userId);
                if (!projectCheck) {
                    return res.status(403).json({ error: 'Voce nao tem permissao para vincular tarefas a este projeto.' });
                }
                taskTeamId = projectCheck.scope === 'team' ? (projectCheck.team_id || taskTeamId) : null;
            }

            if (taskTeamId && !await canEditTeamResource(db, userId, taskTeamId)) {
                return res.status(403).json({ error: 'Sem permissao para criar tarefa neste time.' });
            }

            const result = await db.run(`
                INSERT INTO tasks (user_id, team_id, project_id, title, task_type, due_date)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [userId, taskTeamId, project_id || null, title.trim(), task_type || 'execucao', due_date]);

            return res.status(201).json({ id: result.lastID, message: 'Tarefa adicionada com sucesso!' });
        } catch (error) {
            console.error('[TaskController.create]', error);
            return res.status(500).json({ error: 'Erro ao criar tarefa.' });
        }
    },

    async today(req, res) {
        try {
            const db = await connectDb();
            const today = new Date().toISOString().split('T')[0];

            const tasks = await db.all(`
                SELECT t.*, p.title as project_title, c.name as client_name
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN clients c ON p.client_id = c.id
                LEFT JOIN team_members tm
                    ON tm.team_id = COALESCE(t.team_id, p.team_id)
                    AND tm.user_id = ?
                    AND tm.status = 'active'
                LEFT JOIN project_members pm
                    ON pm.project_id = t.project_id
                    AND pm.user_id = ?
                WHERE (
                    t.user_id = ?
                    OR (t.project_id IS NULL AND tm.user_id IS NOT NULL)
                    OR pm.user_id IS NOT NULL
                    OR (p.scope = 'team' AND tm.role IN ('owner', 'admin', 'gestor'))
                )
                  AND (t.due_date = ? OR (t.due_date < ? AND t.status NOT IN ('concluido', 'concluído')))
                ORDER BY t.due_date ASC, t.id ASC
            `, [req.userId, req.userId, req.userId, today, today]);

            return res.json(tasks);
        } catch (error) {
            console.error('[TaskController.today]', error);
            return res.status(500).json({ error: 'Erro ao buscar tarefas do dia.' });
        }
    },

    async filterByProject(req, res) {
        try {
            const { project_id } = req.params;
            const db = await connectDb();

            const project = await canAccessProject(db, project_id, req.userId);
            if (!project) {
                return res.status(403).json({ error: 'Voce nao tem acesso a este projeto.' });
            }

            const tasks = await db.all(`
                SELECT * FROM tasks 
                WHERE project_id = ?
                ORDER BY status DESC, due_date ASC
            `, [project_id]);

            return res.json(tasks);
        } catch (error) {
            console.error('[TaskController.filterByProject]', error);
            return res.status(500).json({ error: 'Erro ao buscar tarefas do projeto.' });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const { title, task_type, status, due_date } = req.body;
            const db = await connectDb();

            if (title !== undefined && !isNonEmptyString(title, 160)) {
                return res.status(400).json({ error: 'Titulo invalido.' });
            }

            if (due_date !== undefined && !isDate(due_date)) {
                return res.status(400).json({ error: 'Data invalida.' });
            }

            if (!await canAccessTask(db, id, req.userId, true)) {
                return res.status(404).json({ error: 'Tarefa nao encontrada ou sem permissao.' });
            }

            const result = await db.run(`
                UPDATE tasks 
                SET title = COALESCE(?, title),
                    task_type = COALESCE(?, task_type),
                    status = COALESCE(?, status),
                    due_date = COALESCE(?, due_date)
                WHERE id = ?
            `, [title, task_type, status, due_date, id]);

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Tarefa nao encontrada ou sem permissao.' });
            }

            return res.json({ message: 'Tarefa atualizada com sucesso!' });
        } catch (error) {
            console.error('[TaskController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar tarefa.' });
        }
    },

    async destroy(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();

            if (!await canAccessTask(db, id, req.userId, true)) {
                return res.status(404).json({ error: 'Tarefa nao encontrada ou sem permissao.' });
            }

            const result = await db.run('DELETE FROM tasks WHERE id = ?', [id]);

            if (result.changes === 0) {
                return res.status(404).json({ error: 'Tarefa nao encontrada ou sem permissao.' });
            }

            return res.json({ message: 'Tarefa removida.' });
        } catch (error) {
            console.error('[TaskController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao remover tarefa.' });
        }
    }
};
