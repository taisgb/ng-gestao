const connectDb = require('../config/database');
const { isDate, isNonEmptyString } = require('../utils/validators');
const {
    canEditProjectFinancials,
    canEditTeamResource,
    canViewProjectFinancials,
    getProjectAccess,
    getTeamRole
} = require('../utils/permissions');

const DONE_STATUSES = ['concluido', 'concluído', 'concluÃ­do', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TYPES = ['operational', 'financial', 'document', 'invoice', 'service', 'recurring'];
const SCOPES = ['individual', 'team'];

function normalizeType(type) {
    const map = {
        execucao: 'operational',
        execução: 'operational',
        reuniao: 'operational',
        entrega: 'operational',
        financeiro: 'financial',
        nf: 'invoice',
        nota_fiscal: 'invoice',
        documento: 'document',
        servico: 'service',
        serviço: 'service'
    };
    const normalized = map[type] || type || 'operational';
    return TYPES.includes(normalized) ? normalized : 'operational';
}

function normalizeStatus(status) {
    if (status === 'done') return 'concluído';
    if (status === 'open') return 'pendente';
    return status || 'pendente';
}

function isDone(status) {
    return DONE_STATUSES.includes(status);
}

async function canAccessTaskRow(db, task, userId, requireEdit = false) {
    if (!task) return false;

    if (task.user_id === userId || task.created_by === userId || task.assigned_to === userId) return true;

    if (task.project_id) {
        const project = await getProjectAccess(db, userId, task.project_id);
        if (!project) return false;
        if (task.task_type === 'financial' && !await canViewProjectFinancials(db, userId, task.project_id)) return false;
        if (requireEdit && !['owner', 'admin', 'gestor'].includes(project.access_role)) return false;
        return true;
    }

    if (task.team_id) {
        const role = await getTeamRole(db, userId, task.team_id);
        if (!role) return false;
        if (requireEdit && !['owner', 'admin', 'gestor'].includes(role)) return false;
        return true;
    }

    return false;
}

async function getTask(db, id) {
    return db.get(`
        SELECT t.*, p.title as project_title, p.scope as project_scope, p.team_id as project_team_id,
               c.name as client_name, teams.name as team_name, assignee.name as assigned_name
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN clients c ON c.id = COALESCE(t.client_id, p.client_id)
        LEFT JOIN teams ON teams.id = t.team_id
        LEFT JOIN users assignee ON assignee.id = t.assigned_to
        WHERE t.id = ?
    `, [id]);
}

function applyTaskFilters(tasks, query) {
    const today = new Date().toISOString().split('T')[0];

    return tasks.filter(task => {
        if (query.view === 'calendar' && !task.due_date) return false;

        if (query.source && query.source !== 'all') {
            if (query.source === 'project' && !task.project_id) return false;
            if (query.source === 'financial' && task.task_type !== 'financial' && !task.financial_entry_id) return false;
            if (query.source === 'document' && task.task_type !== 'document' && !task.document_id) return false;
            if (query.source === 'invoice' && task.task_type !== 'invoice' && !task.invoice_id) return false;
            if (query.source === 'service' && task.task_type !== 'service' && !task.service_id) return false;
        }

        if (query.scope && query.scope !== 'all') {
            if (query.scope === 'mine' && task.assigned_to && task.assigned_to !== task.current_user_id) return false;
            if (query.scope === 'team' && task.scope !== 'team') return false;
            if (query.scope === 'individual' && task.scope !== 'individual') return false;
        }

        if (query.priority && query.priority !== 'all' && task.priority !== query.priority) return false;

        if (query.status && query.status !== 'all') {
            const done = isDone(task.status);
            const overdue = task.due_date && task.due_date < today && !done;
            if (query.status === 'pending' && (done || overdue || task.status === 'em andamento')) return false;
            if (query.status === 'in_progress' && task.status !== 'em andamento') return false;
            if (query.status === 'done' && !done) return false;
            if (query.status === 'overdue' && !overdue) return false;
        }

        return true;
    });
}

module.exports = {
    async index(req, res) {
        try {
            const { project_id } = req.query;
            const db = await connectDb();

            if (project_id) {
                const project = await getProjectAccess(db, req.userId, project_id);
                if (!project) return res.status(403).json({ error: 'Voce nao tem acesso a este projeto.' });
            }

            const rows = await db.all(`
                SELECT t.*, p.title as project_title, p.scope as project_scope, p.team_id as project_team_id,
                       c.name as client_name, teams.name as team_name, assignee.name as assigned_name
                FROM tasks t
                LEFT JOIN projects p ON p.id = t.project_id
                LEFT JOIN clients c ON c.id = COALESCE(t.client_id, p.client_id)
                LEFT JOIN teams ON teams.id = t.team_id
                LEFT JOIN users assignee ON assignee.id = t.assigned_to
                LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
                LEFT JOIN team_members tm ON tm.team_id = t.team_id AND tm.user_id = ? AND tm.status = 'active'
                WHERE (? IS NULL OR t.project_id = ?)
                  AND (
                    t.user_id = ?
                    OR t.created_by = ?
                    OR t.assigned_to = ?
                    OR pm.user_id IS NOT NULL
                    OR tm.user_id IS NOT NULL
                  )
                ORDER BY COALESCE(t.due_date, '9999-12-31') ASC, t.id DESC
            `, [req.userId, req.userId, project_id || null, project_id || null, req.userId, req.userId, req.userId]);

            const allowed = [];
            for (const row of rows) {
                if (await canAccessTaskRow(db, row, req.userId)) {
                    allowed.push({ ...row, current_user_id: req.userId });
                }
            }

            return res.json(applyTaskFilters(allowed, req.query));
        } catch (error) {
            console.error('[TaskController.index]', error);
            return res.status(500).json({ error: 'Erro ao buscar tarefas.' });
        }
    },

    async create(req, res) {
        try {
            const {
                project_id,
                client_id,
                team_id,
                service_id,
                invoice_id,
                document_id,
                financial_entry_id,
                assigned_to,
                title,
                description,
                task_type,
                priority,
                scope,
                status,
                due_date
            } = req.body;

            if (!isNonEmptyString(title, 160)) return res.status(400).json({ error: 'Titulo e obrigatorio.' });
            if (due_date && !isDate(due_date)) return res.status(400).json({ error: 'Data invalida.' });

            const db = await connectDb();
            const normalizedType = normalizeType(task_type);
            const normalizedStatus = normalizeStatus(status);
            const normalizedPriority = PRIORITIES.includes(priority) ? priority : 'medium';
            let taskScope = SCOPES.includes(scope) ? scope : 'individual';
            let taskTeamId = team_id || null;
            let taskClientId = client_id || null;

            if (project_id) {
                const project = await getProjectAccess(db, req.userId, project_id);
                if (!project) return res.status(403).json({ error: 'Voce nao tem permissao para vincular tarefas a este projeto.' });
                taskScope = project.scope === 'team' ? 'team' : 'individual';
                taskTeamId = project.scope === 'team' ? project.team_id : null;
                taskClientId = taskClientId || project.client_id || null;
                if (normalizedType === 'financial' && !await canEditProjectFinancials(db, req.userId, project_id)) {
                    return res.status(403).json({ error: 'Sem permissao para criar tarefa financeira neste projeto.' });
                }
            }

            if (taskTeamId && !await canEditTeamResource(db, req.userId, taskTeamId)) {
                return res.status(403).json({ error: 'Sem permissao para criar tarefa neste time.' });
            }

            const assignedTo = assigned_to || req.userId;
            const result = await db.run(`
                INSERT INTO tasks (
                    user_id, created_by, assigned_to, team_id, project_id, client_id, service_id, invoice_id,
                    document_id, financial_entry_id, title, description, task_type, priority, scope, status,
                    due_date, completed_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                assignedTo,
                req.userId,
                assignedTo,
                taskTeamId,
                project_id || null,
                taskClientId,
                service_id || null,
                invoice_id || null,
                document_id || null,
                financial_entry_id || null,
                title.trim(),
                description || null,
                normalizedType,
                normalizedPriority,
                taskScope,
                normalizedStatus,
                due_date || null,
                isDone(normalizedStatus) ? new Date().toISOString() : null
            ]);

            return res.status(201).json({ id: result.lastID, message: 'Tarefa criada.' });
        } catch (error) {
            console.error('[TaskController.create]', error);
            return res.status(500).json({ error: 'Erro ao criar tarefa.' });
        }
    },

    async today(req, res) {
        req.query.view = 'calendar';
        req.query.status = 'all';
        const originalJson = res.json.bind(res);
        const today = new Date().toISOString().split('T')[0];
        res.json = payload => originalJson(payload.filter(task => task.due_date && (task.due_date === today || (task.due_date < today && !isDone(task.status)))));
        return module.exports.index(req, res);
    },

    async summary(req, res) {
        try {
            const db = await connectDb();
            const reqLike = { userId: req.userId, query: {} };
            const resLike = { body: null, json(payload) { this.body = payload; return this; }, status() { return this; } };
            await module.exports.index(reqLike, resLike);
            const tasks = resLike.body || [];
            const today = new Date().toISOString().split('T')[0];
            const weekEnd = new Date();
            weekEnd.setDate(weekEnd.getDate() + 7);
            const weekEndString = weekEnd.toISOString().split('T')[0];

            return res.json({
                pending: tasks.filter(task => !isDone(task.status) && task.status !== 'em andamento').length,
                overdue: tasks.filter(task => task.due_date && task.due_date < today && !isDone(task.status)).length,
                completed: tasks.filter(task => isDone(task.status)).length,
                week: tasks.filter(task => task.due_date && task.due_date >= today && task.due_date <= weekEndString).length,
                financial_open: tasks.filter(task => task.task_type === 'financial' && !isDone(task.status)).length
            });
        } catch (error) {
            console.error('[TaskController.summary]', error);
            return res.status(500).json({ error: 'Erro ao resumir tarefas.' });
        }
    },

    async filterByProject(req, res) {
        req.query.project_id = req.params.project_id;
        return module.exports.index(req, res);
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const task = await getTask(db, id);
            if (!await canAccessTaskRow(db, task, req.userId, true)) {
                return res.status(404).json({ error: 'Tarefa nao encontrada ou sem permissao.' });
            }

            const nextStatus = req.body.status === undefined ? null : normalizeStatus(req.body.status);
            const doneAt = nextStatus && isDone(nextStatus) ? new Date().toISOString() : null;

            await db.run(`
                UPDATE tasks
                SET title = COALESCE(?, title),
                    description = COALESCE(?, description),
                    task_type = COALESCE(?, task_type),
                    priority = COALESCE(?, priority),
                    status = COALESCE(?, status),
                    due_date = COALESCE(?, due_date),
                    assigned_to = COALESCE(?, assigned_to),
                    user_id = COALESCE(?, user_id),
                    completed_at = CASE WHEN ? IS NOT NULL THEN ? WHEN ? = 'pendente' THEN NULL ELSE completed_at END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                req.body.title || null,
                req.body.description || null,
                req.body.task_type ? normalizeType(req.body.task_type) : null,
                PRIORITIES.includes(req.body.priority) ? req.body.priority : null,
                nextStatus,
                req.body.due_date || null,
                req.body.assigned_to || null,
                req.body.assigned_to || null,
                doneAt,
                doneAt,
                nextStatus,
                id
            ]);

            return res.json({ message: 'Tarefa atualizada.' });
        } catch (error) {
            console.error('[TaskController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar tarefa.' });
        }
    },

    async destroy(req, res) {
        try {
            const { id } = req.params;
            const db = await connectDb();
            const task = await getTask(db, id);
            if (!await canAccessTaskRow(db, task, req.userId, true)) {
                return res.status(404).json({ error: 'Tarefa nao encontrada ou sem permissao.' });
            }

            await db.run('DELETE FROM tasks WHERE id = ?', [id]);
            return res.json({ message: 'Tarefa removida.' });
        } catch (error) {
            console.error('[TaskController.destroy]', error);
            return res.status(500).json({ error: 'Erro ao remover tarefa.' });
        }
    }
};
