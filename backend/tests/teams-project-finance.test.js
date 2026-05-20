const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const connectDb = require('../src/config/database');
const ClientController = require('../src/controllers/ClientController');
const PersonalController = require('../src/controllers/PersonalController');
const ProjectController = require('../src/controllers/ProjectController');
const ProjectFinancialController = require('../src/controllers/ProjectFinancialController');
const PersonalTransactionController = require('../src/controllers/PersonalTransactionController');
const ServiceController = require('../src/controllers/ServiceController');
const SessionController = require('../src/controllers/SessionController');
const TaskController = require('../src/controllers/TaskController');
const DocumentController = require('../src/controllers/DocumentController');
const UserController = require('../src/controllers/UserController');
const authMiddleware = require('../src/middlewares/auth');
const {
    canEditProjectFinancials,
    canEditTeamResource,
    canManageTeam,
    canViewOwnFinancialShare,
    canViewProjectFinancials,
    canViewTeamResource,
    getTeamRole
} = require('../src/utils/permissions');

console.log = () => {};

async function openTestDb() {
    const dbPath = path.join(os.tmpdir(), `ng-gestao-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    process.env.SQLITE_FILENAME = dbPath;
    const db = await connectDb();

    async function cleanup() {
        await db.close();
        fs.rmSync(dbPath, { force: true });
    }

    return { db, cleanup };
}

async function seedUsers(db) {
    const owner = await db.run(
        "INSERT INTO users (name, email, password, plan) VALUES ('Owner', 'owner@test.local', 'hash', 'convidado')"
    );
    const admin = await db.run(
        "INSERT INTO users (name, email, password, plan) VALUES ('Admin', 'admin@test.local', 'hash', 'convidado')"
    );
    const gestor = await db.run(
        "INSERT INTO users (name, email, password, plan) VALUES ('Gestor', 'gestor@test.local', 'hash', 'convidado')"
    );
    const member = await db.run(
        "INSERT INTO users (name, email, password, plan) VALUES ('Member', 'member@test.local', 'hash', 'convidado')"
    );
    const outside = await db.run(
        "INSERT INTO users (name, email, password, plan) VALUES ('Outside', 'outside@test.local', 'hash', 'convidado')"
    );

    return {
        ownerId: owner.lastID,
        adminId: admin.lastID,
        gestorId: gestor.lastID,
        memberId: member.lastID,
        outsideId: outside.lastID
    };
}

async function seedTeamProject(db) {
    const users = await seedUsers(db);

    const team = await db.run(
        "INSERT INTO teams (name, description, owner_id) VALUES ('Equipe NG', 'Teste', ?)",
        [users.ownerId]
    );
    const teamId = team.lastID;

    await db.run(
        "INSERT INTO team_members (team_id, user_id, email, role, status) VALUES (?, ?, 'owner@test.local', 'owner', 'active')",
        [teamId, users.ownerId]
    );
    await db.run(
        "INSERT INTO team_members (team_id, user_id, email, role, status) VALUES (?, ?, 'admin@test.local', 'admin', 'active')",
        [teamId, users.adminId]
    );
    await db.run(
        "INSERT INTO team_members (team_id, user_id, email, role, status) VALUES (?, ?, 'gestor@test.local', 'gestor', 'active')",
        [teamId, users.gestorId]
    );
    await db.run(
        "INSERT INTO team_members (team_id, user_id, email, role, status) VALUES (?, ?, 'member@test.local', 'member', 'active')",
        [teamId, users.memberId]
    );

    const client = await db.run(
        "INSERT INTO clients (user_id, team_id, scope, name) VALUES (?, ?, 'team', 'Cliente Compartilhado')",
        [users.ownerId, teamId]
    );
    const project = await db.run(
        "INSERT INTO projects (user_id, client_id, team_id, scope, title, base_value, archived) VALUES (?, ?, ?, 'team', 'Site Institucional', 4500, 0)",
        [users.ownerId, client.lastID, teamId]
    );

    return { ...users, teamId, clientId: client.lastID, projectId: project.lastID };
}

function mockResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

async function callController(handler, { userId, params = {}, query = {}, body = {} }) {
    const req = { userId, params, query, body };
    const res = mockResponse();
    await handler(req, res);
    return res;
}

async function callAuthMiddleware(token) {
    const req = { headers: { authorization: token ? `Bearer ${token}` : undefined } };
    const res = mockResponse();
    let nextCalled = false;
    await authMiddleware(req, res, () => {
        nextCalled = true;
    });
    return { req, res, nextCalled };
}

test('team role helpers enforce management and editing rules', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        assert.equal(await getTeamRole(db, seeded.ownerId, seeded.teamId), 'owner');
        assert.equal(await getTeamRole(db, seeded.gestorId, seeded.teamId), 'gestor');
        assert.equal(await canManageTeam(db, seeded.ownerId, seeded.teamId), true);
        assert.equal(await canManageTeam(db, seeded.adminId, seeded.teamId), true);
        assert.equal(await canManageTeam(db, seeded.gestorId, seeded.teamId), false);
        assert.equal(await canEditTeamResource(db, seeded.gestorId, seeded.teamId), true);
        assert.equal(await canEditTeamResource(db, seeded.memberId, seeded.teamId), false);
        assert.equal(await canViewTeamResource(db, seeded.memberId, seeded.teamId), true);
    } finally {
        await cleanup();
    }
});

test('project financial permissions hide global totals from member', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        assert.equal(await canViewProjectFinancials(db, seeded.ownerId, seeded.projectId), true);
        assert.equal(await canViewProjectFinancials(db, seeded.adminId, seeded.projectId), true);
        assert.equal(await canViewProjectFinancials(db, seeded.gestorId, seeded.projectId), true);
        assert.equal(await canEditProjectFinancials(db, seeded.gestorId, seeded.projectId), true);
        assert.equal(await canViewProjectFinancials(db, seeded.memberId, seeded.projectId), false);
        assert.equal(await canViewOwnFinancialShare(db, seeded.memberId, seeded.projectId), false);
    } finally {
        await cleanup();
    }
});

test('project finance summary calculates scope changes, payments, expenses and reimbursements', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);
        const common = [seeded.projectId, seeded.teamId, seeded.ownerId, seeded.ownerId];

        await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, description, category, amount, date, status,
                affects_project_total, affects_my_financial, reimbursable
            )
            VALUES (?, ?, ?, ?, 'scope_adjustment', 'Aumento de escopo', 'aumento de escopo', 2500, '2026-05-01', 'paid', 1, 0, 0)
        `, common);
        await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, description, category, amount, date, status,
                affects_project_total, affects_my_financial, reimbursable
            )
            VALUES (?, ?, ?, ?, 'income', 'Receita extra sem checkbox', 'servico adicional', 2000, '2026-05-01', 'pending', 0, 0, 0)
        `, common);
        await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, description, category, amount, date, status,
                affects_project_total, affects_my_financial, reimbursable
            )
            VALUES (?, ?, ?, ?, 'received_payment', 'Parcela recebida', 'pagamento', 3000, '2026-05-02', 'paid', 0, 1, 0)
        `, common);
        await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, description, category, amount, date, status,
                affects_project_total, affects_my_financial, reimbursable
            )
            VALUES (?, ?, ?, ?, 'expense', 'Elementor', 'plugin', 300, '2026-05-03', 'paid', 0, 1, 1)
        `, common);
        await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, description, category, amount, date, status,
                affects_project_total, affects_my_financial, reimbursable
            )
            VALUES (?, ?, ?, ?, 'expense', 'Hospedagem', 'hospedagem', 500, '2026-05-04', 'paid', 0, 1, 0)
        `, common);
        await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, description, category, amount, date, status,
                affects_project_total, affects_my_financial, reimbursable
            )
            VALUES (?, ?, ?, ?, 'reimbursement', 'Reembolso Elementor', 'reembolso de plugin', 300, '2026-05-05', 'paid', 0, 1, 0)
        `, common);

        const summary = await ProjectFinancialController._calculateSummary(db, seeded.projectId);

        assert.equal(summary.base_contract_value, 4500);
        assert.equal(summary.additional_income, 4500);
        assert.equal(summary.updated_total_value, 9000);
        assert.equal(summary.updated_value, 9000);
        assert.equal(summary.total_received, 5800);
        assert.equal(summary.received, 5800);
        assert.equal(summary.total_pending, 3200);
        assert.equal(summary.total_expenses, 800);
        assert.equal(summary.expenses, 800);
        assert.equal(summary.reimbursable_expenses, 0);
        assert.equal(summary.reimbursed_amount, 300);
        assert.equal(summary.estimated_net_balance, 8200);
        assert.equal(summary.net_balance, 8200);
    } finally {
        await cleanup();
    }
});

test('client archive and restore are reversible and blocked for team member', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const blocked = await callController(ClientController.archive, {
            userId: seeded.memberId,
            params: { id: seeded.clientId }
        });
        assert.equal(blocked.statusCode, 403);

        const archived = await callController(ClientController.archive, {
            userId: seeded.gestorId,
            params: { id: seeded.clientId }
        });
        assert.equal(archived.statusCode, 200);

        let client = await db.get('SELECT archived FROM clients WHERE id = ?', [seeded.clientId]);
        assert.equal(client.archived, 1);

        const archivedList = await callController(ClientController.index, {
            userId: seeded.ownerId,
            query: { status: 'archived' }
        });
        assert.equal(archivedList.statusCode, 200);
        assert.equal(archivedList.body.length, 1);
        assert.equal(archivedList.body[0].id, seeded.clientId);

        const projects = await callController(ClientController.projects, {
            userId: seeded.ownerId,
            params: { id: seeded.clientId },
            query: { include_archived: 'true' }
        });
        assert.equal(projects.statusCode, 200);
        assert.equal(projects.body.length, 1);
        assert.equal(projects.body[0].id, seeded.projectId);

        const restored = await callController(ClientController.restore, {
            userId: seeded.adminId,
            params: { id: seeded.clientId }
        });
        assert.equal(restored.statusCode, 200);

        client = await db.get('SELECT archived FROM clients WHERE id = ?', [seeded.clientId]);
        assert.equal(client.archived, 0);
    } finally {
        await cleanup();
    }
});

test('project archive and restore are reversible and blocked for team member', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const blocked = await callController(ProjectController.archive, {
            userId: seeded.memberId,
            params: { id: seeded.projectId }
        });
        assert.equal(blocked.statusCode, 404);

        const archived = await callController(ProjectController.archive, {
            userId: seeded.gestorId,
            params: { id: seeded.projectId }
        });
        assert.equal(archived.statusCode, 200);

        let project = await db.get('SELECT archived, archived_at FROM projects WHERE id = ?', [seeded.projectId]);
        assert.equal(project.archived, 1);
        assert.ok(project.archived_at);

        const archivedList = await callController(ProjectController.index, {
            userId: seeded.ownerId,
            query: { status: 'archived' }
        });
        assert.equal(archivedList.statusCode, 200);
        assert.equal(archivedList.body.length, 1);
        assert.equal(archivedList.body[0].id, seeded.projectId);

        const restored = await callController(ProjectController.restore, {
            userId: seeded.adminId,
            params: { id: seeded.projectId }
        });
        assert.equal(restored.statusCode, 200);

        project = await db.get('SELECT archived, archived_at FROM projects WHERE id = ?', [seeded.projectId]);
        assert.equal(project.archived, 0);
        assert.equal(project.archived_at, null);
    } finally {
        await cleanup();
    }
});

test('team client can be used for an individual project without leaking to team members', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const created = await callController(ProjectController.create, {
            userId: seeded.memberId,
            body: {
                client_id: seeded.clientId,
                title: 'Projeto privado do membro',
                scope: 'individual',
                team_id: seeded.teamId,
                member_ids: [seeded.ownerId, seeded.adminId],
                base_value: 900,
                deadline: '2026-06-10'
            }
        });
        assert.equal(created.statusCode, 201);

        const project = await db.get('SELECT * FROM projects WHERE id = ?', [created.body.id]);
        assert.equal(project.scope, 'individual');
        assert.equal(project.team_id, null);
        assert.equal(project.user_id, seeded.memberId);

        const members = await db.all('SELECT user_id, role FROM project_members WHERE project_id = ? ORDER BY user_id', [created.body.id]);
        assert.deepEqual(members, [{ user_id: seeded.memberId, role: 'owner' }]);

        const ownerList = await callController(ProjectController.index, {
            userId: seeded.ownerId,
            query: { status: 'all' }
        });
        assert.equal(ownerList.body.some(item => item.id === created.body.id), false);

        const memberList = await callController(ProjectController.index, {
            userId: seeded.memberId,
            query: { status: 'all', scope: 'individual' }
        });
        assert.equal(memberList.body.some(item => item.id === created.body.id), true);

        const memberShow = await callController(ProjectController.show, {
            userId: seeded.memberId,
            params: { id: created.body.id }
        });
        assert.equal(memberShow.statusCode, 200);
        assert.equal(memberShow.body.id, created.body.id);
        assert.equal(memberShow.body.scope, 'individual');

        await db.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [created.body.id, seeded.memberId]);

        const ownerShowWithoutProjectMember = await callController(ProjectController.show, {
            userId: seeded.memberId,
            params: { id: created.body.id }
        });
        assert.equal(ownerShowWithoutProjectMember.statusCode, 200);
        assert.equal(ownerShowWithoutProjectMember.body.id, created.body.id);
        assert.equal(ownerShowWithoutProjectMember.body.team_id, null);

        const outsideShow = await callController(ProjectController.show, {
            userId: seeded.outsideId,
            params: { id: created.body.id }
        });
        assert.equal(outsideShow.statusCode, 403);

        const task = await callController(TaskController.create, {
            userId: seeded.memberId,
            body: {
                project_id: created.body.id,
                title: 'Tarefa privada',
                due_date: '2026-06-11'
            }
        });
        assert.equal(task.statusCode, 201);

        const savedTask = await db.get('SELECT team_id FROM tasks WHERE id = ?', [task.body.id]);
        assert.equal(savedTask.team_id, null);
    } finally {
        await cleanup();
    }
});

test('team project adds only selected project members and keeps unselected team member out', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const created = await callController(ProjectController.create, {
            userId: seeded.ownerId,
            body: {
                client_id: seeded.clientId,
                title: 'Projeto de equipe selecionado',
                scope: 'team',
                team_id: seeded.teamId,
                member_ids: [seeded.adminId],
                base_value: 3000,
                deadline: '2026-07-01'
            }
        });
        assert.equal(created.statusCode, 201);

        const project = await db.get('SELECT * FROM projects WHERE id = ?', [created.body.id]);
        assert.equal(project.scope, 'team');
        assert.equal(project.team_id, seeded.teamId);

        const members = await db.all('SELECT user_id, role FROM project_members WHERE project_id = ? ORDER BY user_id', [created.body.id]);
        assert.deepEqual(members, [
            { user_id: seeded.ownerId, role: 'owner' },
            { user_id: seeded.adminId, role: 'member' }
        ]);

        const unselectedMemberList = await callController(ProjectController.index, {
            userId: seeded.memberId,
            query: { status: 'all' }
        });
        assert.equal(unselectedMemberList.body.some(item => item.id === created.body.id), false);

        const unselectedShow = await callController(ProjectController.show, {
            userId: seeded.memberId,
            params: { id: created.body.id }
        });
        assert.equal(unselectedShow.statusCode, 403);

        const unselectedFinance = await callController(ProjectController.finance, {
            userId: seeded.memberId,
            params: { id: created.body.id }
        });
        assert.equal(unselectedFinance.statusCode, 404);

        const ownerShow = await callController(ProjectController.show, {
            userId: seeded.ownerId,
            params: { id: created.body.id }
        });
        assert.equal(ownerShow.statusCode, 200);
        assert.equal(ownerShow.body.id, created.body.id);

        const selectedShow = await callController(ProjectController.show, {
            userId: seeded.adminId,
            params: { id: created.body.id }
        });
        assert.equal(selectedShow.statusCode, 200);
        assert.equal(selectedShow.body.id, created.body.id);

        const gestorShow = await callController(ProjectController.show, {
            userId: seeded.gestorId,
            params: { id: created.body.id }
        });
        assert.equal(gestorShow.statusCode, 200);
        assert.equal(gestorShow.body.id, created.body.id);

        const missingShow = await callController(ProjectController.show, {
            userId: seeded.ownerId,
            params: { id: 999999 }
        });
        assert.equal(missingShow.statusCode, 404);

        const selectedList = await callController(ProjectController.index, {
            userId: seeded.adminId,
            query: { status: 'all', scope: 'team' }
        });
        assert.equal(selectedList.body.some(item => item.id === created.body.id), true);

        const task = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: created.body.id,
                title: 'Tarefa da equipe',
                due_date: '2026-07-02'
            }
        });
        assert.equal(task.statusCode, 201);

        const savedTask = await db.get('SELECT team_id FROM tasks WHERE id = ?', [task.body.id]);
        assert.equal(savedTask.team_id, seeded.teamId);

        const unselectedTasks = await callController(TaskController.index, {
            userId: seeded.memberId,
            query: { project_id: created.body.id }
        });
        assert.equal(unselectedTasks.statusCode, 403);
    } finally {
        await cleanup();
    }
});

test('project owner can transfer ownership to an existing project member', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const created = await callController(ProjectController.create, {
            userId: seeded.ownerId,
            body: {
                client_id: seeded.clientId,
                title: 'Projeto para repassar',
                scope: 'individual',
                base_value: 1200
            }
        });
        assert.equal(created.statusCode, 201);

        await db.run(`
            INSERT OR IGNORE INTO project_members (project_id, user_id, role)
            VALUES (?, ?, 'collaborator')
        `, [created.body.id, seeded.adminId]);

        const blocked = await callController(ProjectController.transferOwner, {
            userId: seeded.memberId,
            params: { id: created.body.id },
            body: { new_owner_id: seeded.adminId }
        });
        assert.equal(blocked.statusCode, 403);

        const transferred = await callController(ProjectController.transferOwner, {
            userId: seeded.ownerId,
            params: { id: created.body.id },
            body: { new_owner_id: seeded.adminId }
        });
        assert.equal(transferred.statusCode, 200);

        const project = await db.get('SELECT user_id FROM projects WHERE id = ?', [created.body.id]);
        assert.equal(project.user_id, seeded.adminId);

        const roles = await db.all(
            'SELECT user_id, role FROM project_members WHERE project_id = ? ORDER BY user_id',
            [created.body.id]
        );
        assert.deepEqual(roles, [
            { user_id: seeded.ownerId, role: 'collaborator' },
            { user_id: seeded.adminId, role: 'owner' }
        ]);

        const newOwnerShow = await callController(ProjectController.show, {
            userId: seeded.adminId,
            params: { id: created.body.id }
        });
        assert.equal(newOwnerShow.statusCode, 200);
        assert.equal(newOwnerShow.body.access_role, 'owner');

        const oldOwnerShow = await callController(ProjectController.show, {
            userId: seeded.ownerId,
            params: { id: created.body.id }
        });
        assert.equal(oldOwnerShow.statusCode, 200);
        assert.equal(oldOwnerShow.body.access_role, 'collaborator');
    } finally {
        await cleanup();
    }
});

test('team agenda tasks are visible to members but editable only by team editors', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const memberCreate = await callController(TaskController.create, {
            userId: seeded.memberId,
            body: {
                team_id: seeded.teamId,
                title: 'Tarefa de time bloqueada',
                task_type: 'execucao',
                due_date: '2026-05-20'
            }
        });
        assert.equal(memberCreate.statusCode, 403);

        const gestorCreate = await callController(TaskController.create, {
            userId: seeded.gestorId,
            body: {
                team_id: seeded.teamId,
                title: 'Revisar briefing',
                task_type: 'execucao',
                due_date: '2026-05-20'
            }
        });
        assert.equal(gestorCreate.statusCode, 201);

        const memberList = await callController(TaskController.index, {
            userId: seeded.memberId
        });
        assert.equal(memberList.statusCode, 200);
        assert.equal(memberList.body.length, 1);
        assert.equal(memberList.body[0].team_name, 'Equipe NG');

        const memberUpdate = await callController(TaskController.update, {
            userId: seeded.memberId,
            params: { id: gestorCreate.body.id },
            body: { status: 'concluído' }
        });
        assert.equal(memberUpdate.statusCode, 404);

        const adminUpdate = await callController(TaskController.update, {
            userId: seeded.adminId,
            params: { id: gestorCreate.body.id },
            body: { status: 'concluído' }
        });
        assert.equal(adminUpdate.statusCode, 200);
    } finally {
        await cleanup();
    }
});

test('operational tasks support list/calendar filters and financial privacy', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const noDateTask = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                title: 'Organizar arquivos',
                task_type: 'document',
                priority: 'urgent'
            }
        });
        assert.equal(noDateTask.statusCode, 201);

        const financialTask = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                title: 'Cobrar parcela',
                task_type: 'financial',
                priority: 'urgent',
                due_date: '2000-01-01'
            }
        });
        assert.equal(financialTask.statusCode, 201);

        const list = await callController(TaskController.index, {
            userId: seeded.ownerId,
            query: {}
        });
        assert.equal(list.statusCode, 200);
        assert.equal(list.body.some(task => task.id === noDateTask.body.id), true);

        const calendar = await callController(TaskController.index, {
            userId: seeded.ownerId,
            query: { view: 'calendar' }
        });
        assert.equal(calendar.statusCode, 200);
        assert.equal(calendar.body.some(task => task.id === noDateTask.body.id), false);
        assert.equal(calendar.body.some(task => task.id === financialTask.body.id), true);

        const financialFilter = await callController(TaskController.index, {
            userId: seeded.ownerId,
            query: { source: 'financial', priority: 'urgent' }
        });
        assert.equal(financialFilter.statusCode, 200);
        assert.equal(financialFilter.body.length, 1);
        assert.equal(financialFilter.body[0].id, financialTask.body.id);

        const overdue = await callController(TaskController.index, {
            userId: seeded.ownerId,
            query: { status: 'overdue' }
        });
        assert.equal(overdue.statusCode, 200);
        assert.equal(overdue.body.some(task => task.id === financialTask.body.id), true);

        const memberFinancial = await callController(TaskController.index, {
            userId: seeded.memberId,
            query: { source: 'financial' }
        });
        assert.equal(memberFinancial.statusCode, 200);
        assert.equal(memberFinancial.body.some(task => task.id === financialTask.body.id), false);

        const savedFinancialTask = await db.get('SELECT team_id FROM tasks WHERE id = ?', [financialTask.body.id]);
        assert.equal(savedFinancialTask.team_id, seeded.teamId);
    } finally {
        await cleanup();
    }
});

test('team services are editable by team editors, visible to members and hidden from outsiders', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const memberCreate = await callController(ServiceController.create, {
            userId: seeded.memberId,
            body: {
                team_id: seeded.teamId,
                name: 'Servico bloqueado',
                default_value: 100,
                description: 'Nao deve criar'
            }
        });
        assert.equal(memberCreate.statusCode, 403);

        const ownerCreate = await callController(ServiceController.create, {
            userId: seeded.ownerId,
            body: {
                team_id: seeded.teamId,
                name: 'Landing Page',
                default_value: 2500,
                description: 'Pagina comercial'
            }
        });
        assert.equal(ownerCreate.statusCode, 201);

        const memberList = await callController(ServiceController.index, {
            userId: seeded.memberId,
            query: { status: 'active' }
        });
        assert.equal(memberList.statusCode, 200);
        assert.equal(memberList.body.length, 1);
        assert.equal(memberList.body[0].can_edit, 0);
        assert.equal(memberList.body[0].team_name, 'Equipe NG');

        const outsideList = await callController(ServiceController.index, {
            userId: seeded.outsideId,
            query: { status: 'all' }
        });
        assert.equal(outsideList.statusCode, 200);
        assert.equal(outsideList.body.length, 0);

        const memberEdit = await callController(ServiceController.update, {
            userId: seeded.memberId,
            params: { id: ownerCreate.body.id },
            body: { name: 'Tentativa member' }
        });
        assert.equal(memberEdit.statusCode, 403);

        const gestorEdit = await callController(ServiceController.update, {
            userId: seeded.gestorId,
            params: { id: ownerCreate.body.id },
            body: { name: 'Landing Page Premium', default_value: 3200 }
        });
        assert.equal(gestorEdit.statusCode, 200);

        let service = await db.get('SELECT name, default_value FROM services WHERE id = ?', [ownerCreate.body.id]);
        assert.equal(service.name, 'Landing Page Premium');
        assert.equal(service.default_value, 3200);

        const memberArchive = await callController(ServiceController.archive, {
            userId: seeded.memberId,
            params: { id: ownerCreate.body.id }
        });
        assert.equal(memberArchive.statusCode, 403);

        const adminArchive = await callController(ServiceController.archive, {
            userId: seeded.adminId,
            params: { id: ownerCreate.body.id }
        });
        assert.equal(adminArchive.statusCode, 200);

        service = await db.get('SELECT archived, active FROM services WHERE id = ?', [ownerCreate.body.id]);
        assert.equal(service.archived, 1);
        assert.equal(service.active, 0);

        const archivedList = await callController(ServiceController.index, {
            userId: seeded.ownerId,
            query: { status: 'archived' }
        });
        assert.equal(archivedList.statusCode, 200);
        assert.equal(archivedList.body.length, 1);

        const gestorRestore = await callController(ServiceController.restore, {
            userId: seeded.gestorId,
            params: { id: ownerCreate.body.id }
        });
        assert.equal(gestorRestore.statusCode, 200);

        service = await db.get('SELECT archived, active FROM services WHERE id = ?', [ownerCreate.body.id]);
        assert.equal(service.archived, 0);
        assert.equal(service.active, 1);
    } finally {
        await cleanup();
    }
});

test('individual services are private to owner', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const created = await callController(ServiceController.create, {
            userId: seeded.ownerId,
            body: {
                name: 'Consultoria individual',
                default_value: 500,
                description: 'Servico privado'
            }
        });
        assert.equal(created.statusCode, 201);

        const ownerList = await callController(ServiceController.index, {
            userId: seeded.ownerId,
            query: { status: 'active' }
        });
        assert.equal(ownerList.statusCode, 200);
        assert.equal(ownerList.body.length, 1);
        assert.equal(ownerList.body[0].name, 'Consultoria individual');

        const memberList = await callController(ServiceController.index, {
            userId: seeded.memberId,
            query: { status: 'active' }
        });
        assert.equal(memberList.statusCode, 200);
        assert.equal(memberList.body.length, 0);

        const memberEdit = await callController(ServiceController.update, {
            userId: seeded.memberId,
            params: { id: created.body.id },
            body: { name: 'Nao pode' }
        });
        assert.equal(memberEdit.statusCode, 403);
    } finally {
        await cleanup();
    }
});

test('documents support individual privacy, team permissions, links and reversible archive', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const individualDoc = await callController(DocumentController.create, {
            userId: seeded.ownerId,
            body: {
                file_name: 'Contrato privado',
                file_url: 'https://drive.google.com/private-contract',
                provider: 'drive',
                document_type: 'contract',
                description: 'Documento individual'
            }
        });
        assert.equal(individualDoc.statusCode, 201);

        const ownerDocs = await callController(DocumentController.index, {
            userId: seeded.ownerId,
            query: { status: 'active' }
        });
        assert.equal(ownerDocs.statusCode, 200);
        assert.equal(ownerDocs.body.some(document => document.id === individualDoc.body.id), true);

        const outsideDocs = await callController(DocumentController.index, {
            userId: seeded.outsideId,
            query: { status: 'all' }
        });
        assert.equal(outsideDocs.statusCode, 200);
        assert.equal(outsideDocs.body.some(document => document.id === individualDoc.body.id), false);

        const memberCreate = await callController(DocumentController.create, {
            userId: seeded.memberId,
            body: {
                team_id: seeded.teamId,
                file_name: 'Documento bloqueado',
                file_url: 'https://example.com/bloqueado.pdf',
                provider: 'external',
                document_type: 'receipt'
            }
        });
        assert.equal(memberCreate.statusCode, 403);

        const teamDoc = await callController(DocumentController.create, {
            userId: seeded.gestorId,
            body: {
                team_id: seeded.teamId,
                file_name: 'Briefing do time',
                file_url: 'https://drive.google.com/team-briefing',
                provider: 'drive',
                document_type: 'briefing',
                client_id: seeded.clientId
            }
        });
        assert.equal(teamDoc.statusCode, 201);

        const projectDoc = await callController(DocumentController.create, {
            userId: seeded.ownerId,
            body: {
                file_name: 'Pasta do projeto',
                file_url: 'https://drive.google.com/project-folder',
                provider: 'drive',
                document_type: 'folder',
                project_id: seeded.projectId
            }
        });
        assert.equal(projectDoc.statusCode, 201);

        const savedProjectDoc = await db.get('SELECT team_id, project_id FROM documents WHERE id = ?', [projectDoc.body.id]);
        assert.equal(savedProjectDoc.team_id, seeded.teamId);
        assert.equal(savedProjectDoc.project_id, seeded.projectId);

        const memberDocs = await callController(DocumentController.index, {
            userId: seeded.memberId,
            query: { status: 'active', document_type: 'briefing' }
        });
        assert.equal(memberDocs.statusCode, 200);
        assert.equal(memberDocs.body.length, 1);
        assert.equal(memberDocs.body[0].id, teamDoc.body.id);
        assert.equal(memberDocs.body[0].can_edit, 0);

        const outsideTeamDocs = await callController(DocumentController.index, {
            userId: seeded.outsideId,
            query: { status: 'all', team_id: seeded.teamId }
        });
        assert.equal(outsideTeamDocs.statusCode, 200);
        assert.equal(outsideTeamDocs.body.length, 0);

        const memberEdit = await callController(DocumentController.update, {
            userId: seeded.memberId,
            params: { id: teamDoc.body.id },
            body: { file_name: 'Tentativa member' }
        });
        assert.equal(memberEdit.statusCode, 403);

        const adminEdit = await callController(DocumentController.update, {
            userId: seeded.adminId,
            params: { id: teamDoc.body.id },
            body: {
                file_name: 'Briefing atualizado',
                file_url: 'https://drive.google.com/team-briefing-v2',
                document_type: 'briefing'
            }
        });
        assert.equal(adminEdit.statusCode, 200);

        let savedTeamDoc = await db.get('SELECT file_name FROM documents WHERE id = ?', [teamDoc.body.id]);
        assert.equal(savedTeamDoc.file_name, 'Briefing atualizado');

        const memberArchive = await callController(DocumentController.archive, {
            userId: seeded.memberId,
            params: { id: teamDoc.body.id }
        });
        assert.equal(memberArchive.statusCode, 403);

        const ownerArchive = await callController(DocumentController.archive, {
            userId: seeded.ownerId,
            params: { id: teamDoc.body.id }
        });
        assert.equal(ownerArchive.statusCode, 200);

        const archivedDocs = await callController(DocumentController.index, {
            userId: seeded.ownerId,
            query: { status: 'archived', document_type: 'briefing' }
        });
        assert.equal(archivedDocs.statusCode, 200);
        assert.equal(archivedDocs.body.length, 1);
        assert.equal(archivedDocs.body[0].id, teamDoc.body.id);

        const gestorRestore = await callController(DocumentController.restore, {
            userId: seeded.gestorId,
            params: { id: teamDoc.body.id }
        });
        assert.equal(gestorRestore.statusCode, 200);

        savedTeamDoc = await db.get('SELECT archived FROM documents WHERE id = ?', [teamDoc.body.id]);
        assert.equal(savedTeamDoc.archived, 0);

        const clientDocs = await callController(DocumentController.byClient, {
            userId: seeded.memberId,
            params: { id: seeded.clientId },
            query: { status: 'all' }
        });
        assert.equal(clientDocs.statusCode, 200);
        assert.equal(clientDocs.body.some(document => document.id === teamDoc.body.id), true);

        const projectDocs = await callController(DocumentController.byProject, {
            userId: seeded.memberId,
            params: { id: seeded.projectId },
            query: { status: 'all' }
        });
        assert.equal(projectDocs.statusCode, 200);
        assert.equal(projectDocs.body.some(document => document.id === projectDoc.body.id), true);
    } finally {
        await cleanup();
    }
});

test('super admin bootstrap creates account, refreshes password and login token opens profile', async () => {
    const previousEmail = process.env.SUPER_ADMIN_EMAIL;
    const previousPassword = process.env.SUPER_ADMIN_PASSWORD;
    const previousJwtSecret = process.env.JWT_SECRET;
    const previousAppSecret = process.env.APP_SECRET;

    process.env.SUPER_ADMIN_EMAIL = 'boss@test.local';
    process.env.SUPER_ADMIN_PASSWORD = 'PrimeiraSenha123';
    process.env.JWT_SECRET = 'jwt-test-secret';
    delete process.env.APP_SECRET;

    const { db, cleanup } = await openTestDb();
    try {
        let admin = await db.get('SELECT * FROM users WHERE email = ?', ['boss@test.local']);
        assert.ok(admin);
        assert.equal(admin.plan, 'admin');
        assert.equal(admin.role, 'owner');
        assert.equal(admin.is_super_admin, 1);

        let login = await callController(SessionController.store, {
            body: {
                email: 'BOSS@test.local',
                password: 'PrimeiraSenha123'
            }
        });
        assert.equal(login.statusCode, 200);
        assert.ok(login.body.token);
        assert.equal(login.body.user.role, 'owner');
        assert.equal(login.body.user.is_super_admin, 1);

        const auth = await callAuthMiddleware(login.body.token);
        assert.equal(auth.nextCalled, true);
        assert.equal(auth.req.userId, admin.id);

        const profile = await callController(UserController.show, {
            userId: auth.req.userId
        });
        assert.equal(profile.statusCode, 200);
        assert.equal(profile.body.email, 'boss@test.local');

        process.env.SUPER_ADMIN_PASSWORD = 'SenhaNova456';
        await connectDb();

        const oldPasswordLogin = await callController(SessionController.store, {
            body: {
                email: 'boss@test.local',
                password: 'PrimeiraSenha123'
            }
        });
        assert.equal(oldPasswordLogin.statusCode, 401);

        login = await callController(SessionController.store, {
            body: {
                email: 'boss@test.local',
                password: 'SenhaNova456'
            }
        });
        assert.equal(login.statusCode, 200);
        assert.ok(login.body.token);

        admin = await db.get('SELECT * FROM users WHERE email = ?', ['boss@test.local']);
        assert.equal(admin.plan, 'admin');
        assert.equal(admin.role, 'owner');
        assert.equal(admin.is_super_admin, 1);

        const wrongPassword = await callController(SessionController.store, {
            body: {
                email: 'boss@test.local',
                password: 'senha-errada'
            }
        });
        assert.equal(wrongPassword.statusCode, 401);

        const missingUser = await callController(SessionController.store, {
            body: {
                email: 'ninguem@test.local',
                password: 'SenhaNova456'
            }
        });
        assert.equal(missingUser.statusCode, 401);
    } finally {
        if (previousEmail === undefined) delete process.env.SUPER_ADMIN_EMAIL;
        else process.env.SUPER_ADMIN_EMAIL = previousEmail;

        if (previousPassword === undefined) delete process.env.SUPER_ADMIN_PASSWORD;
        else process.env.SUPER_ADMIN_PASSWORD = previousPassword;

        if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousJwtSecret;

        if (previousAppSecret === undefined) delete process.env.APP_SECRET;
        else process.env.APP_SECRET = previousAppSecret;

        await cleanup();
    }
});

test('personal transactions are private, filterable and summarized by month', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        await callController(PersonalController.updateStatus, {
            userId: seeded.ownerId,
            body: {
                total_bank_balance: 1000,
                total_debt: 2000,
                credit_card_bill: 350
            }
        });

        const income = await callController(PersonalTransactionController.create, {
            userId: seeded.ownerId,
            body: {
                type: 'income',
                description: 'Receita de consultoria',
                category: 'Consultoria',
                amount: 1500,
                date: '2026-05-10',
                status: 'paid',
                source: 'manual'
            }
        });
        assert.equal(income.statusCode, 201);

        const expense = await callController(PersonalTransactionController.create, {
            userId: seeded.ownerId,
            body: {
                type: 'expense',
                description: 'Assinatura',
                category: 'Assinaturas',
                amount: 200,
                date: '2026-05-11',
                status: 'expected',
                payment_method: 'Cartao',
                source: 'recurring',
                is_recurring: 1
            }
        });
        assert.equal(expense.statusCode, 201);

        const otherExpense = await callController(PersonalTransactionController.create, {
            userId: seeded.memberId,
            body: {
                type: 'expense',
                description: 'Privado de outro usuario',
                category: 'Software',
                amount: 999,
                date: '2026-05-12',
                status: 'paid',
                source: 'manual'
            }
        });
        assert.equal(otherExpense.statusCode, 201);

        const ownerIncomeList = await callController(PersonalTransactionController.index, {
            userId: seeded.ownerId,
            query: { type: 'income', status: 'paid', month: '05', year: '2026' }
        });
        assert.equal(ownerIncomeList.statusCode, 200);
        assert.equal(ownerIncomeList.body.length, 1);
        assert.equal(ownerIncomeList.body[0].id, income.body.id);

        const memberCannotEdit = await callController(PersonalTransactionController.update, {
            userId: seeded.memberId,
            params: { id: income.body.id },
            body: { description: 'Nao pode editar' }
        });
        assert.equal(memberCannotEdit.statusCode, 404);

        const ownerEdit = await callController(PersonalTransactionController.update, {
            userId: seeded.ownerId,
            params: { id: expense.body.id },
            body: { status: 'paid', amount: 250 }
        });
        assert.equal(ownerEdit.statusCode, 200);

        const summary = await callController(PersonalTransactionController.summary, {
            userId: seeded.ownerId,
            query: { month: '05', year: '2026' }
        });
        assert.equal(summary.statusCode, 200);
        assert.equal(summary.body.bank_balance, 1000);
        assert.equal(summary.body.total_income_month, 1500);
        assert.equal(summary.body.total_expense_month, 250);
        assert.equal(summary.body.projected_balance, 2250);
        assert.equal(summary.body.total_debt, 2000);
        assert.equal(summary.body.current_card_bill, 350);

        const archived = await callController(PersonalTransactionController.destroy, {
            userId: seeded.ownerId,
            params: { id: expense.body.id }
        });
        assert.equal(archived.statusCode, 200);

        const afterArchive = await callController(PersonalTransactionController.index, {
            userId: seeded.ownerId,
            query: { type: 'expense', month: '05', year: '2026' }
        });
        assert.equal(afterArchive.body.length, 0);
    } finally {
        await cleanup();
    }
});

test('project financial entry sync creates a single personal transaction for impacted user', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const entryResult = await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, description, category, amount, date, status,
                payment_method, affects_project_total, affects_my_financial, reimbursable
            )
            VALUES (?, ?, ?, ?, 'expense', 'Plugin pago', 'Plugin', 120, '2026-05-15', 'paid', 'Cartao', 0, 1, 0)
        `, [seeded.projectId, seeded.teamId, seeded.memberId, seeded.ownerId]);

        const entry = await db.get('SELECT * FROM project_financial_entries WHERE id = ?', [entryResult.lastID]);
        await PersonalTransactionController._syncFromProjectFinancialEntry(db, entry);
        await PersonalTransactionController._syncFromProjectFinancialEntry(db, entry);

        const rows = await db.all(
            'SELECT * FROM personal_transactions WHERE project_financial_entry_id = ?',
            [entry.id]
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].user_id, seeded.memberId);
        assert.equal(rows[0].type, 'expense');
        assert.equal(rows[0].source, 'project');
    } finally {
        await cleanup();
    }
});
