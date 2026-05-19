const connectDb = require('../config/database');
const { isDate, isNonEmptyString } = require('../utils/validators');

async function canAccessProject(db, projectId, userId) {
    return db.get(`
        SELECT p.id
        FROM projects p
        LEFT JOIN project_members pm 
            ON pm.project_id = p.id AND pm.user_id = ?
        WHERE p.id = ?
          AND p.archived = 0
          AND (p.user_id = ? OR pm.user_id IS NOT NULL)
    `, [userId, projectId, userId]);
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
                SELECT t.*, p.title as project_title
                FROM tasks t
                LEFT JOIN projects p ON t.project_id = p.id
                WHERE t.user_id = ?
                ORDER BY t.due_date ASC, t.id ASC
            `, [req.userId]);

            return res.json(tasks);
        } catch (error) {
            console.error('[TaskController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar tarefas.' });
        }
    },

    async create(req, res) {
        try {
            const { project_id, title, task_type, due_date } = req.body;
            const userId = req.userId;

            if (!isNonEmptyString(title, 160) || !isDate(due_date)) {
                return res.status(400).json({ error: 'Titulo e data de vencimento valida sao obrigatorios.' });
            }

            const db = await connectDb();

            if (project_id) {
                const projectCheck = await canAccessProject(db, project_id, userId);
                if (!projectCheck) {
                    return res.status(403).json({ error: 'Voce nao tem permissao para vincular tarefas a este projeto.' });
                }
            }

            const result = await db.run(`
                INSERT INTO tasks (user_id, project_id, title, task_type, due_date)
                VALUES (?, ?, ?, ?, ?)
            `, [userId, project_id || null, title.trim(), task_type || 'execucao', due_date]);

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
                WHERE t.user_id = ? 
                  AND (t.due_date = ? OR (t.due_date < ? AND t.status NOT IN ('concluido', 'concluído')))
                ORDER BY t.due_date ASC, t.id ASC
            `, [req.userId, today, today]);

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

            const result = await db.run(`
                UPDATE tasks 
                SET title = COALESCE(?, title),
                    task_type = COALESCE(?, task_type),
                    status = COALESCE(?, status),
                    due_date = COALESCE(?, due_date)
                WHERE id = ? AND user_id = ?
            `, [title, task_type, status, due_date, id, req.userId]);

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

            const result = await db.run(
                'DELETE FROM tasks WHERE id = ? AND user_id = ?',
                [id, req.userId]
            );

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
