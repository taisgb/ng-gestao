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
const InvoiceController = require('../src/controllers/InvoiceController');
const TaskController = require('../src/controllers/TaskController');
const TeamController = require('../src/controllers/TeamController');
const DocumentController = require('../src/controllers/DocumentController');
const UserController = require('../src/controllers/UserController');
const authMiddleware = require('../src/middlewares/auth');
const {
    canAssignTask,
    canEditClient,
    canEditPersonalFinance,
    canEditProjectFinancials,
    canEditTeamResource,
    canManageTeam,
    canViewOwnFinancialShare,
    canViewProjectFinancials,
    canViewTeamResource,
    getTeamRole,
    sanitizeClientForRole,
    sanitizeProjectForRole,
    sanitizeTaskForRole,
    sanitizeUserForRole
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

test('split private project keeps participant financial entries private until shared', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);
        await db.run(
            "UPDATE projects SET billing_mode = 'split_private', financial_visibility = 'shared_authorized' WHERE id = ?",
            [seeded.projectId]
        );
        await db.run(
            "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')",
            [seeded.projectId, seeded.memberId]
        );

        const privateCreate = await callController(PersonalTransactionController.create, {
            userId: seeded.memberId,
            body: {
                type: 'income',
                description: 'Receita privada da participante',
                category: 'Projeto',
                amount: 1400,
                gross_amount: 4800,
                own_amount: 1400,
                transfer_amount: 3400,
                date: '2026-05-01',
                payment_due_date: '2026-06-10',
                status: 'expected',
                source: 'project',
                financial_type: 'revenue',
                financial_scope: 'project',
                project_id: seeded.projectId,
                visibility: 'private'
            }
        });
        assert.equal(privateCreate.statusCode, 201);

        const ownerView = await callController(ProjectFinancialController.index, {
            userId: seeded.ownerId,
            params: { id: seeded.projectId }
        });
        assert.equal(ownerView.statusCode, 200);
        assert.equal(ownerView.body.private_entries.length, 0);

        const memberView = await callController(ProjectFinancialController.index, {
            userId: seeded.memberId,
            params: { id: seeded.projectId }
        });
        assert.equal(memberView.statusCode, 200);
        assert.equal(memberView.body.private_entries.length, 1);
        assert.equal(Number(memberView.body.private_entries[0].own_amount), 1400);

        await callController(PersonalTransactionController.create, {
            userId: seeded.memberId,
            body: {
                type: 'income',
                description: 'Receita compartilhada com responsável',
                category: 'Projeto',
                amount: 900,
                gross_amount: 900,
                own_amount: 900,
                date: '2026-05-02',
                payment_due_date: '2026-06-15',
                status: 'expected',
                source: 'project',
                financial_type: 'revenue',
                financial_scope: 'project',
                project_id: seeded.projectId,
                visibility: 'shared_with_owner'
            }
        });

        const ownerAfterShare = await callController(ProjectFinancialController.index, {
            userId: seeded.ownerId,
            params: { id: seeded.projectId }
        });
        assert.equal(ownerAfterShare.statusCode, 200);
        assert.equal(ownerAfterShare.body.private_entries.length, 1);
        assert.equal(Number(ownerAfterShare.body.private_entries[0].own_amount), 900);
    } finally {
        await cleanup();
    }
});

test('private owner visibility and private project invoice do not leak to team admins', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);
        await db.run(
            "UPDATE projects SET financial_visibility = 'private_owner' WHERE id = ?",
            [seeded.projectId]
        );

        assert.equal(await canViewProjectFinancials(db, seeded.ownerId, seeded.projectId), true);
        assert.equal(await canViewProjectFinancials(db, seeded.adminId, seeded.projectId), false);

        await db.run(
            "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')",
            [seeded.projectId, seeded.memberId]
        );
        const invoice = await db.run(`
            INSERT INTO invoices (user_id, project_id, number, client_name, amount, invoice_visibility, issue_date, status)
            VALUES (?, ?, 'NF-PRIVATE', 'Cliente Compartilhado', 1200, 'private', '2026-05-20', 'emitida')
        `, [seeded.memberId, seeded.projectId]);

        const ownerInvoices = await callController(InvoiceController.index, {
            userId: seeded.ownerId,
            query: { project_id: seeded.projectId }
        });
        assert.equal(ownerInvoices.statusCode, 200);
        assert.equal(ownerInvoices.body.some(item => item.id === invoice.lastID), false);

        const memberInvoices = await callController(InvoiceController.index, {
            userId: seeded.memberId,
            query: { project_id: seeded.projectId }
        });
        assert.equal(memberInvoices.statusCode, 200);
        assert.equal(memberInvoices.body.some(item => item.id === invoice.lastID), true);
    } finally {
        await cleanup();
    }
});

test('acl sanitizes client, project, task and user sensitive fields for restricted roles', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        await db.run(
            "UPDATE clients SET contact_name = 'Cliente Segredo', phone = '71999990000', email = 'cliente@privado.local', document = '12345678000199' WHERE id = ?",
            [seeded.clientId]
        );
        await db.run(
            "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')",
            [seeded.projectId, seeded.memberId]
        );

        const memberClients = await callController(ClientController.index, {
            userId: seeded.memberId,
            query: { status: 'all' }
        });
        assert.equal(memberClients.statusCode, 200);
        const memberClient = memberClients.body.find(client => client.id === seeded.clientId);
        assert.equal(memberClient.email, null);
        assert.equal(memberClient.phone, null);
        assert.equal(memberClient.document, null);
        assert.equal(memberClient.contact_name, null);
        assert.equal(memberClient.sensitive_hidden, true);

        const ownerClient = await db.get('SELECT * FROM clients WHERE id = ?', [seeded.clientId]);
        assert.equal(await canEditClient(db, seeded.ownerId, ownerClient), true);
        assert.equal(await canEditClient(db, seeded.memberId, ownerClient), false);

        const memberProject = await callController(ProjectController.show, {
            userId: seeded.memberId,
            params: { id: seeded.projectId }
        });
        assert.equal(memberProject.statusCode, 200);
        assert.equal(memberProject.body.base_value, null);
        assert.equal(memberProject.body.total_value, null);
        assert.equal(memberProject.body.can_view_financials, false);

        const financialEntry = await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, financial_type, description, category, amount, date, status
            )
            VALUES (?, ?, ?, ?, 'operational_expense', 'operational_expense', 'Fatura privada', 'Plugin', 99, '2026-05-20', 'pending')
        `, [seeded.projectId, seeded.teamId, seeded.ownerId, seeded.ownerId]);

        const financialTask = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                assigned_to: seeded.memberId,
                financial_entry_id: financialEntry.lastID,
                task_type: 'financial',
                title: 'Validar comprovante'
            }
        });
        assert.equal(financialTask.statusCode, 201);

        const memberTasks = await callController(TaskController.index, {
            userId: seeded.memberId,
            query: { source: 'financial' }
        });
        assert.equal(memberTasks.statusCode, 200);
        const memberTask = memberTasks.body.find(task => task.id === financialTask.body.id);
        assert.equal(memberTask.financial_entry_id, null);
        assert.equal(memberTask.invoice_id, null);
        assert.equal(memberTask.sensitive_hidden, true);

        assert.equal(await canAssignTask(db, seeded.ownerId, seeded.memberId, {
            project: { id: seeded.projectId, user_id: seeded.ownerId }
        }), true);
        assert.equal(await canAssignTask(db, seeded.ownerId, seeded.outsideId, {
            project: { id: seeded.projectId, user_id: seeded.ownerId }
        }), false);
        assert.equal(await canEditPersonalFinance(db, seeded.ownerId, seeded.ownerId), true);
        assert.equal(await canEditPersonalFinance(db, seeded.adminId, seeded.ownerId), false);

        const sanitizedClient = sanitizeClientForRole(ownerClient, false);
        assert.equal(sanitizedClient.email, null);
        const sanitizedProject = sanitizeProjectForRole({ base_value: 4500, total_value: 4500 }, false);
        assert.equal(sanitizedProject.base_value, null);
        const sanitizedTask = sanitizeTaskForRole({ task_type: 'financial', financial_entry_id: 1, invoice_id: 2 }, false);
        assert.equal(sanitizedTask.financial_entry_id, null);
        const sanitizedUser = sanitizeUserForRole({ id: seeded.ownerId, name: 'Owner', email: 'owner@test.local', role: 'owner', plan: 'admin' }, false);
        assert.equal(sanitizedUser.email, undefined);
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
        assert.equal(summary.additional_income, 2500);
        assert.equal(summary.updated_total_value, 7000);
        assert.equal(summary.updated_value, 7000);
        assert.equal(summary.total_received, 5800);
        assert.equal(summary.received, 5800);
        assert.equal(summary.total_pending, 1200);
        assert.equal(summary.total_expenses, 800);
        assert.equal(summary.expenses, 800);
        assert.equal(summary.reimbursable_expenses, 0);
        assert.equal(summary.reimbursed_amount, 300);
        assert.equal(summary.estimated_net_balance, 6200);
        assert.equal(summary.net_balance, 6200);
    } finally {
        await cleanup();
    }
});

test('project finance engine separates gross revenue, transfers, reimbursements and real profit', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);
        await db.run('UPDATE projects SET base_value = 0 WHERE id = ?', [seeded.projectId]);

        await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, financial_type, description, category,
                amount, gross_amount, own_amount, transfer_amount, date, payment_due_date, status,
                affects_project_total, affects_my_financial, affects_personal_finance
            )
            VALUES (?, ?, ?, ?, 'revenue', 'revenue', 'NF equipe', 'NF', 4800, 4800, 1400, 3400, '2026-05-20', '2026-06-10', 'paid', 1, 1, 1)
        `, [seeded.projectId, seeded.teamId, seeded.ownerId, seeded.ownerId]);

        await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, financial_type, description, category,
                amount, gross_amount, transfer_amount, date, status
            )
            VALUES (?, ?, ?, ?, 'transfer', 'transfer', 'Repasse designers', 'Repasse', 3400, 3400, 3400, '2026-06-11', 'pending')
        `, [seeded.projectId, seeded.teamId, seeded.ownerId, seeded.ownerId]);

        let summary = await ProjectFinancialController._calculateSummary(db, seeded.projectId);
        assert.equal(summary.gross_revenue, 4800);
        assert.equal(summary.transfers_total, 3400);
        assert.equal(summary.own_amount, 1400);
        assert.equal(summary.pending_transfer, 3400);

        await db.run("UPDATE project_financial_entries SET status = 'paid' WHERE financial_type = 'transfer' AND project_id = ?", [seeded.projectId]);
        summary = await ProjectFinancialController._calculateSummary(db, seeded.projectId);
        assert.equal(summary.pending_transfer, 0);
        assert.equal(summary.net_balance, 1400);
    } finally {
        await cleanup();
    }
});

test('reimbursable and non-reimbursable costs affect updated value and profit correctly', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, financial_type, description, category,
                amount, gross_amount, date, status, reimbursable, billable_to_client, affects_project_total
            )
            VALUES (?, ?, ?, ?, 'operational_expense', 'operational_expense', 'Hospedagem', 'Hospedagem', 548.65, 548.65, '2026-05-20', 'pending', 1, 1, 1)
        `, [seeded.projectId, seeded.teamId, seeded.ownerId, seeded.ownerId]);

        await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, financial_type, description, category,
                amount, gross_amount, date, status, reimbursable, billable_to_client, affects_project_total
            )
            VALUES (?, ?, ?, ?, 'operational_expense', 'operational_expense', 'Ferramenta interna', 'Software', 200, 200, '2026-05-20', 'paid', 0, 0, 0)
        `, [seeded.projectId, seeded.teamId, seeded.ownerId, seeded.ownerId]);

        const summary = await ProjectFinancialController._calculateSummary(db, seeded.projectId);
        assert.equal(summary.updated_value, 5048.65);
        assert.equal(summary.reimbursable_expenses, 548.65);
        assert.equal(summary.operational_expenses, 748.65);
        assert.equal(summary.net_balance, 4300);
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

test('project editors can update core fields and warranty dates are calculated', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const blocked = await callController(ProjectController.update, {
            userId: seeded.memberId,
            params: { id: seeded.projectId },
            body: { title: 'Tentativa bloqueada' }
        });
        assert.equal(blocked.statusCode, 404);

        const updated = await callController(ProjectController.update, {
            userId: seeded.gestorId,
            params: { id: seeded.projectId },
            body: {
                title: 'Site institucional atualizado',
                description: 'Escopo revisado',
                client_id: seeded.clientId,
                deadline: '2026-07-20',
                status: 'garantia',
                base_value: 6200,
                warranty_start_date: '2026-07-21',
                warranty_days: 30,
                scope: 'team',
                team_id: seeded.teamId
            }
        });
        assert.equal(updated.statusCode, 200);

        const project = await db.get('SELECT * FROM projects WHERE id = ?', [seeded.projectId]);
        assert.equal(project.title, 'Site institucional atualizado');
        assert.equal(project.description, 'Escopo revisado');
        assert.equal(project.client_id, seeded.clientId);
        assert.equal(project.status, 'garantia');
        assert.equal(project.base_value, 6200);
        assert.equal(project.deadline, '2026-07-20');
        assert.equal(project.warranty_start_date, '2026-07-21');
        assert.equal(project.warranty_days, 30);
        assert.equal(project.warranty_end_date, '2026-08-20');
        assert.equal(project.team_id, seeded.teamId);
    } finally {
        await cleanup();
    }
});

test('dashboard warranty alerts list accessible projects with expiring or overdue warranty', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const soonDate = new Date();
        soonDate.setDate(soonDate.getDate() + 5);
        const farDate = new Date();
        farDate.setDate(farDate.getDate() + 30);

        await db.run(
            "UPDATE projects SET status = 'garantia', warranty_start_date = ?, warranty_days = 1, warranty_end_date = ? WHERE id = ?",
            [yesterdayDate.toISOString().split('T')[0], yesterdayDate.toISOString().split('T')[0], seeded.projectId]
        );

        const soonProject = await db.run(
            "INSERT INTO projects (user_id, client_id, team_id, scope, title, status, warranty_start_date, warranty_days, warranty_end_date, archived) VALUES (?, ?, ?, 'team', 'Garantia vencendo', 'garantia', ?, 5, ?, 0)",
            [seeded.ownerId, seeded.clientId, seeded.teamId, new Date().toISOString().split('T')[0], soonDate.toISOString().split('T')[0]]
        );

        const farProject = await db.run(
            "INSERT INTO projects (user_id, client_id, team_id, scope, title, status, warranty_start_date, warranty_days, warranty_end_date, archived) VALUES (?, ?, ?, 'team', 'Garantia distante', 'garantia', ?, 30, ?, 0)",
            [seeded.ownerId, seeded.clientId, seeded.teamId, new Date().toISOString().split('T')[0], farDate.toISOString().split('T')[0]]
        );

        const ownerAlerts = await callController(ProjectController.warrantyAlerts, {
            userId: seeded.ownerId,
            query: { days: '15', limit: '5' }
        });
        assert.equal(ownerAlerts.statusCode, 200);
        assert.equal(ownerAlerts.body.some(project => project.id === seeded.projectId && project.alert_level === 'overdue'), true);
        assert.equal(ownerAlerts.body.some(project => project.id === soonProject.lastID && project.alert_level === 'soon'), true);
        assert.equal(ownerAlerts.body.some(project => project.id === farProject.lastID), false);

        const memberAlerts = await callController(ProjectController.warrantyAlerts, {
            userId: seeded.memberId,
            query: { days: '15' }
        });
        assert.equal(memberAlerts.statusCode, 200);
        assert.equal(memberAlerts.body.length, 0);
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

test('project owner removes collaborator and removed collaborator loses access', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const created = await callController(ProjectController.create, {
            userId: seeded.ownerId,
            body: {
                client_id: seeded.clientId,
                title: 'Projeto com colaborador removivel',
                scope: 'individual',
                base_value: 1800
            }
        });
        assert.equal(created.statusCode, 201);

        await db.run(
            "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'collaborator')",
            [created.body.id, seeded.adminId]
        );

        const collaboratorBefore = await callController(ProjectController.show, {
            userId: seeded.adminId,
            params: { id: created.body.id }
        });
        assert.equal(collaboratorBefore.statusCode, 200);

        const memberCannotRemove = await callController(ProjectController.removeMember, {
            userId: seeded.adminId,
            params: { projectId: created.body.id, memberId: seeded.ownerId }
        });
        assert.equal(memberCannotRemove.statusCode, 403);

        const ownerCannotRemoveSelf = await callController(ProjectController.removeMember, {
            userId: seeded.ownerId,
            params: { projectId: created.body.id, memberId: seeded.ownerId }
        });
        assert.equal(ownerCannotRemoveSelf.statusCode, 403);

        const removed = await callController(ProjectController.removeMember, {
            userId: seeded.ownerId,
            params: { projectId: created.body.id, memberId: seeded.adminId }
        });
        assert.equal(removed.statusCode, 200);

        const collaboratorAfter = await callController(ProjectController.show, {
            userId: seeded.adminId,
            params: { id: created.body.id }
        });
        assert.equal(collaboratorAfter.statusCode, 403);
    } finally {
        await cleanup();
    }
});

test('task status endpoint completes and reopens tasks without date cast errors', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const task = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                title: 'Conferir entrega',
                due_date: '2026-06-20'
            }
        });
        assert.equal(task.statusCode, 201);

        const done = await callController(TaskController.updateStatus, {
            userId: seeded.ownerId,
            params: { id: task.body.id },
            body: { status: 'done' }
        });
        assert.equal(done.statusCode, 200);

        let saved = await db.get('SELECT status, completed_at FROM tasks WHERE id = ?', [task.body.id]);
        assert.equal(saved.status, 'concluido');
        assert.ok(saved.completed_at);

        const reopened = await callController(TaskController.updateStatus, {
            userId: seeded.ownerId,
            params: { id: task.body.id },
            body: { status: 'pending' }
        });
        assert.equal(reopened.statusCode, 200);

        saved = await db.get('SELECT status, completed_at FROM tasks WHERE id = ?', [task.body.id]);
        assert.equal(saved.status, 'pendente');
        assert.equal(saved.completed_at, null);

        const blocked = await callController(TaskController.updateStatus, {
            userId: seeded.outsideId,
            params: { id: task.body.id },
            body: { status: 'done' }
        });
        assert.equal(blocked.statusCode, 404);
    } finally {
        await cleanup();
    }
});

test('task due date persists on create, update, list, summary and dashboard feed', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);
        const today = new Date().toISOString().split('T')[0];
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrow = tomorrowDate.toISOString().split('T')[0];

        const createdWithDueDate = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                title: 'Tarefa com prazo',
                due_date: today,
                priority: 'high'
            }
        });
        assert.equal(createdWithDueDate.statusCode, 201);

        let saved = await db.get('SELECT due_date FROM tasks WHERE id = ?', [createdWithDueDate.body.id]);
        assert.equal(String(saved.due_date).slice(0, 10), today);

        const list = await callController(TaskController.index, {
            userId: seeded.ownerId,
            query: {}
        });
        assert.equal(list.statusCode, 200);
        const listedTask = list.body.find(task => task.id === createdWithDueDate.body.id);
        assert.equal(listedTask.due_date, today);

        const dashboardTasks = await callController(TaskController.today, {
            userId: seeded.ownerId,
            query: {}
        });
        assert.equal(dashboardTasks.statusCode, 200);
        assert.equal(dashboardTasks.body.some(task => task.id === createdWithDueDate.body.id && task.due_date === today), true);

        const summary = await callController(TaskController.summary, {
            userId: seeded.ownerId,
            query: {}
        });
        assert.equal(summary.statusCode, 200);
        assert.equal(summary.body.week >= 1, true);

        const noDateTask = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                title: 'Tarefa sem prazo'
            }
        });
        assert.equal(noDateTask.statusCode, 201);

        const addDueDate = await callController(TaskController.update, {
            userId: seeded.ownerId,
            params: { id: noDateTask.body.id },
            body: { due_date: today }
        });
        assert.equal(addDueDate.statusCode, 200);

        saved = await db.get('SELECT due_date FROM tasks WHERE id = ?', [noDateTask.body.id]);
        assert.equal(String(saved.due_date).slice(0, 10), today);

        const changeDueDate = await callController(TaskController.update, {
            userId: seeded.ownerId,
            params: { id: noDateTask.body.id },
            body: { due_date: tomorrow }
        });
        assert.equal(changeDueDate.statusCode, 200);

        saved = await db.get('SELECT due_date FROM tasks WHERE id = ?', [noDateTask.body.id]);
        assert.equal(String(saved.due_date).slice(0, 10), tomorrow);

        const removeDueDate = await callController(TaskController.update, {
            userId: seeded.ownerId,
            params: { id: noDateTask.body.id },
            body: { due_date: null }
        });
        assert.equal(removeDueDate.statusCode, 200);

        saved = await db.get('SELECT due_date FROM tasks WHERE id = ?', [noDateTask.body.id]);
        assert.equal(saved.due_date, null);

        const calendar = await callController(TaskController.index, {
            userId: seeded.ownerId,
            query: { view: 'calendar' }
        });
        assert.equal(calendar.statusCode, 200);
        assert.equal(Array.isArray(calendar.body), true);
        assert.equal(calendar.body.some(task => task.id === createdWithDueDate.body.id), true);
        assert.equal(calendar.body.some(task => task.id === noDateTask.body.id), false);
    } finally {
        await cleanup();
    }
});

test('tasks support responsible assignment and full editing with project permissions', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        await db.run(
            "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')",
            [seeded.projectId, seeded.memberId]
        );
        await db.run(
            "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'collaborator')",
            [seeded.projectId, seeded.adminId]
        );

        const assignedTask = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                assigned_to: seeded.memberId,
                title: 'Publicar landing page',
                description: 'Checklist operacional',
                priority: 'high',
                due_date: '2026-06-15'
            }
        });
        assert.equal(assignedTask.statusCode, 201);

        let saved = await db.get(
            'SELECT user_id, created_by, assigned_to, title, priority, due_date FROM tasks WHERE id = ?',
            [assignedTask.body.id]
        );
        assert.equal(saved.user_id, seeded.ownerId);
        assert.equal(saved.created_by, seeded.ownerId);
        assert.equal(saved.assigned_to, seeded.memberId);
        assert.equal(saved.priority, 'high');
        assert.equal(String(saved.due_date).slice(0, 10), '2026-06-15');

        const memberCompletesOwnTask = await callController(TaskController.updateStatus, {
            userId: seeded.memberId,
            params: { id: assignedTask.body.id },
            body: { status: 'done' }
        });
        assert.equal(memberCompletesOwnTask.statusCode, 200);

        const memberCannotReassign = await callController(TaskController.update, {
            userId: seeded.memberId,
            params: { id: assignedTask.body.id },
            body: { assigned_to: seeded.adminId }
        });
        assert.equal(memberCannotReassign.statusCode, 403);

        const ownerUpdatesTask = await callController(TaskController.update, {
            userId: seeded.ownerId,
            params: { id: assignedTask.body.id },
            body: {
                title: 'Publicar landing page revisada',
                description: 'Checklist revisado',
                priority: 'urgent',
                status: 'em andamento',
                assigned_to: seeded.adminId,
                due_date: '2026-06-20'
            }
        });
        assert.equal(ownerUpdatesTask.statusCode, 200);

        saved = await db.get(
            'SELECT title, description, priority, status, assigned_to, due_date FROM tasks WHERE id = ?',
            [assignedTask.body.id]
        );
        assert.equal(saved.title, 'Publicar landing page revisada');
        assert.equal(saved.description, 'Checklist revisado');
        assert.equal(saved.priority, 'urgent');
        assert.equal(saved.status, 'em andamento');
        assert.equal(saved.assigned_to, seeded.adminId);
        assert.equal(String(saved.due_date).slice(0, 10), '2026-06-20');

        const outsideAssigneeBlocked = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                assigned_to: seeded.outsideId,
                title: 'Tarefa com responsavel externo'
            }
        });
        assert.equal(outsideAssigneeBlocked.statusCode, 400);
    } finally {
        await cleanup();
    }
});

test('dashboard week endpoint returns upcoming open tasks with responsible data', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);
        await db.run(
            "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')",
            [seeded.projectId, seeded.memberId]
        );

        const todayDate = new Date();
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const outsideWeekDate = new Date();
        outsideWeekDate.setDate(outsideWeekDate.getDate() + 10);
        const today = todayDate.toISOString().split('T')[0];
        const tomorrow = tomorrowDate.toISOString().split('T')[0];
        const outsideWeek = outsideWeekDate.toISOString().split('T')[0];

        const todayTask = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                assigned_to: seeded.memberId,
                title: 'Tarefa de hoje',
                priority: 'high',
                due_date: today
            }
        });
        assert.equal(todayTask.statusCode, 201);

        const tomorrowTask = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                assigned_to: seeded.memberId,
                title: 'Tarefa de amanha',
                priority: 'urgent',
                due_date: tomorrow
            }
        });
        assert.equal(tomorrowTask.statusCode, 201);

        const outsideTask = await callController(TaskController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                title: 'Tarefa fora da semana',
                due_date: outsideWeek
            }
        });
        assert.equal(outsideTask.statusCode, 201);

        await callController(TaskController.updateStatus, {
            userId: seeded.ownerId,
            params: { id: todayTask.body.id },
            body: { status: 'done' }
        });

        const weekTasks = await callController(TaskController.week, {
            userId: seeded.ownerId,
            query: { limit: 5 }
        });
        assert.equal(weekTasks.statusCode, 200);
        assert.equal(weekTasks.body.some(task => task.id === todayTask.body.id), false);
        assert.equal(weekTasks.body.some(task => task.id === tomorrowTask.body.id), true);
        assert.equal(weekTasks.body.some(task => task.id === outsideTask.body.id), false);
        assert.equal(weekTasks.body[0].assigned_name, 'Member');
    } finally {
        await cleanup();
    }
});

test('team archive and restore are owner-only and filtered by status', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const memberBlocked = await callController(TeamController.archive, {
            userId: seeded.memberId,
            params: { id: seeded.teamId }
        });
        assert.equal(memberBlocked.statusCode, 403);

        const archived = await callController(TeamController.archive, {
            userId: seeded.ownerId,
            params: { id: seeded.teamId }
        });
        assert.equal(archived.statusCode, 200);

        const activeList = await callController(TeamController.index, {
            userId: seeded.ownerId,
            query: {}
        });
        assert.equal(activeList.statusCode, 200);
        assert.equal(activeList.body.some(team => team.id === seeded.teamId), false);

        const archivedList = await callController(TeamController.index, {
            userId: seeded.ownerId,
            query: { status: 'archived' }
        });
        assert.equal(archivedList.statusCode, 200);
        assert.equal(archivedList.body.some(team => team.id === seeded.teamId), true);

        const restored = await callController(TeamController.restore, {
            userId: seeded.ownerId,
            params: { id: seeded.teamId }
        });
        assert.equal(restored.statusCode, 200);

        const restoredActiveList = await callController(TeamController.index, {
            userId: seeded.ownerId,
            query: {}
        });
        assert.equal(restoredActiveList.body.some(team => team.id === seeded.teamId), true);
    } finally {
        await cleanup();
    }
});

test('team delete is blocked by active dependencies and allowed when safe', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        const blocked = await callController(TeamController.destroy, {
            userId: seeded.ownerId,
            params: { id: seeded.teamId }
        });
        assert.equal(blocked.statusCode, 409);
        assert.equal(blocked.body.blockers.active_projects, 1);
        assert.equal(blocked.body.blockers.active_members, 3);

        const safeTeam = await db.run(
            "INSERT INTO teams (name, owner_id, archived) VALUES ('Time vazio', ?, 1)",
            [seeded.ownerId]
        );
        await db.run(
            "INSERT INTO team_members (team_id, user_id, email, role, status) VALUES (?, ?, 'owner@test.local', 'owner', 'active')",
            [safeTeam.lastID, seeded.ownerId]
        );

        const deleted = await callController(TeamController.destroy, {
            userId: seeded.ownerId,
            params: { id: safeTeam.lastID }
        });
        assert.equal(deleted.statusCode, 200);

        const gone = await db.get('SELECT id FROM teams WHERE id = ?', [safeTeam.lastID]);
        assert.equal(gone, undefined);
    } finally {
        await cleanup();
    }
});

test('removing team member revokes team project access and task assignment', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        await db.run(
            "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')",
            [seeded.projectId, seeded.memberId]
        );
        const task = await db.run(`
            INSERT INTO tasks (user_id, created_by, assigned_to, project_id, team_id, title, status)
            VALUES (?, ?, ?, ?, ?, 'Tarefa atribuida', 'pendente')
        `, [seeded.memberId, seeded.ownerId, seeded.memberId, seeded.projectId, seeded.teamId]);

        const before = await callController(ProjectController.show, {
            userId: seeded.memberId,
            params: { id: seeded.projectId }
        });
        assert.equal(before.statusCode, 200);

        const memberRow = await db.get(
            "SELECT id FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'",
            [seeded.teamId, seeded.memberId]
        );
        const removed = await callController(TeamController.removeMember, {
            userId: seeded.ownerId,
            params: { id: seeded.teamId, memberId: memberRow.id }
        });
        assert.equal(removed.statusCode, 200);

        const projectMembership = await db.get(
            'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
            [seeded.projectId, seeded.memberId]
        );
        assert.equal(projectMembership, undefined);

        const savedTask = await db.get('SELECT assigned_to FROM tasks WHERE id = ?', [task.lastID]);
        assert.equal(savedTask.assigned_to, null);

        const after = await callController(ProjectController.show, {
            userId: seeded.memberId,
            params: { id: seeded.projectId }
        });
        assert.equal(after.statusCode, 403);
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
        assert.equal(memberUpdate.statusCode, 403);

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

        const superUser = await db.run(
            "INSERT INTO users (name, email, password, plan, role, is_super_admin) VALUES ('Super', 'super@test.local', 'hash', 'admin', 'super_admin', 1)"
        );
        const superAdminDocs = await callController(DocumentController.index, {
            userId: superUser.lastID,
            query: { status: 'all' }
        });
        assert.equal(superAdminDocs.statusCode, 200);
        assert.equal(superAdminDocs.body.some(document => document.id === individualDoc.body.id), false);

        const sharedPrivateDoc = await callController(DocumentController.share, {
            userId: seeded.ownerId,
            params: { id: individualDoc.body.id },
            body: { user_id: seeded.memberId, permission: 'view' }
        });
        assert.equal(sharedPrivateDoc.statusCode, 201);

        const memberPrivateDocs = await callController(DocumentController.index, {
            userId: seeded.memberId,
            query: { status: 'all' }
        });
        assert.equal(memberPrivateDocs.body.some(document => document.id === individualDoc.body.id), true);

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
        assert.equal(Boolean(memberDocs.body[0].can_edit), false);

        await db.run(
            "UPDATE clients SET email = 'cliente@example.com', phone = '71999990000', document = '12345678900', contact_name = 'Contato' WHERE id = ?",
            [seeded.clientId]
        );
        const memberClients = await callController(ClientController.index, {
            userId: seeded.memberId,
            query: { status: 'all' }
        });
        const memberClient = memberClients.body.find(client => client.id === seeded.clientId);
        assert.equal(memberClient.email, null);
        assert.equal(memberClient.phone, null);
        assert.equal(memberClient.document, null);

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

        const searchByName = await callController(DocumentController.index, {
            userId: seeded.ownerId,
            query: { status: 'all', search: 'Briefing atualizado' }
        });
        assert.equal(searchByName.statusCode, 200);
        assert.equal(searchByName.body.some(document => document.id === teamDoc.body.id), true);
        assert.equal(searchByName.body.some(document => document.id === individualDoc.body.id), false);

        const searchByProject = await callController(DocumentController.index, {
            userId: seeded.ownerId,
            query: { status: 'all', search: 'Site Institucional' }
        });
        assert.equal(searchByProject.statusCode, 200);
        assert.equal(searchByProject.body.some(document => document.id === projectDoc.body.id), true);

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
        assert.equal(projectDocs.body.some(document => document.id === projectDoc.body.id), false);

        await db.run(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')",
            [seeded.projectId, seeded.memberId]
        );
        const selectedMemberProjectDocs = await callController(DocumentController.byProject, {
            userId: seeded.memberId,
            params: { id: seeded.projectId },
            query: { status: 'all' }
        });
        assert.equal(selectedMemberProjectDocs.body.some(document => document.id === projectDoc.body.id), true);

        const financialEntry = await db.run(`
            INSERT INTO project_financial_entries (
                project_id, team_id, user_id, created_by, type, description, category, amount, date, status
            )
            VALUES (?, ?, ?, ?, 'expense', 'Comprovante privado', 'Plugin', 300, '2026-05-20', 'paid')
        `, [seeded.projectId, seeded.teamId, seeded.ownerId, seeded.ownerId]);
        const financialDoc = await callController(DocumentController.create, {
            userId: seeded.ownerId,
            body: {
                file_name: 'Comprovante financeiro',
                file_url: 'https://example.com/comprovante.pdf',
                provider: 'external',
                document_type: 'receipt',
                team_id: seeded.teamId,
                project_financial_entry_id: financialEntry.lastID
            }
        });
        assert.equal(financialDoc.statusCode, 201);

        const memberFinancialDocs = await callController(DocumentController.index, {
            userId: seeded.memberId,
            query: { status: 'all' }
        });
        assert.equal(memberFinancialDocs.body.some(document => document.id === financialDoc.body.id), false);
    } finally {
        await cleanup();
    }
});

test('project invoices respect financial project roles and block regular members', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        await db.run(
            "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')",
            [seeded.projectId, seeded.memberId]
        );

        const invoice = await callController(InvoiceController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                number: '001',
                client_name: 'Cliente Compartilhado',
                description: 'NF de projeto',
                amount: 4800,
                issue_date: '2026-05-20',
                status: 'emitida'
            }
        });
        assert.equal(invoice.statusCode, 201);

        const memberInvoices = await callController(InvoiceController.index, {
            userId: seeded.memberId,
            query: {}
        });
        assert.equal(memberInvoices.statusCode, 200);
        assert.equal(memberInvoices.body.some(item => item.id === invoice.body.id), false);

        const memberUpdateBlocked = await callController(InvoiceController.update, {
            userId: seeded.memberId,
            params: { id: invoice.body.id },
            body: { status: 'paga' }
        });
        assert.equal(memberUpdateBlocked.statusCode, 403);

        await db.run(
            "UPDATE project_members SET role = 'financeiro' WHERE project_id = ? AND user_id = ?",
            [seeded.projectId, seeded.memberId]
        );

        const financeiroInvoices = await callController(InvoiceController.index, {
            userId: seeded.memberId,
            query: { project_id: seeded.projectId }
        });
        assert.equal(financeiroInvoices.statusCode, 200);
        assert.equal(financeiroInvoices.body.some(item => item.id === invoice.body.id && Number(item.amount) === 4800), true);
        assert.equal(financeiroInvoices.body.find(item => item.id === invoice.body.id).can_edit, true);

        const financeiroUpdate = await callController(InvoiceController.update, {
            userId: seeded.memberId,
            params: { id: invoice.body.id },
            body: { status: 'paga' }
        });
        assert.equal(financeiroUpdate.statusCode, 200);

        const invoiceDocument = await callController(DocumentController.create, {
            userId: seeded.memberId,
            body: {
                invoice_id: invoice.body.id,
                file_name: 'PDF NF 001',
                file_url: 'https://example.com/nf-001.pdf',
                provider: 'external',
                document_type: 'invoice'
            }
        });
        assert.equal(invoiceDocument.statusCode, 201);

        const savedInvoiceDocument = await db.get(
            'SELECT team_id, invoice_id FROM documents WHERE id = ?',
            [invoiceDocument.body.id]
        );
        assert.equal(savedInvoiceDocument.team_id, seeded.teamId);
        assert.equal(savedInvoiceDocument.invoice_id, invoice.body.id);

        const invoiceDocs = await callController(DocumentController.byInvoice, {
            userId: seeded.memberId,
            params: { id: invoice.body.id },
            query: { status: 'all' }
        });
        assert.equal(invoiceDocs.statusCode, 200);
        assert.equal(invoiceDocs.body.some(document => document.id === invoiceDocument.body.id), true);
    } finally {
        await cleanup();
    }
});

test('project document feed is strictly scoped to the current project', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);
        const projectB = await db.run(
            "INSERT INTO projects (user_id, client_id, team_id, scope, title, base_value, archived) VALUES (?, ?, ?, 'team', 'Projeto B', 3000, 0)",
            [seeded.ownerId, seeded.clientId, seeded.teamId]
        );
        const projectBId = projectB.lastID;

        const projectADoc = await callController(DocumentController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                file_name: 'Contrato Projeto A',
                file_url: 'https://example.com/projeto-a.pdf',
                provider: 'external',
                document_type: 'contract'
            }
        });
        assert.equal(projectADoc.statusCode, 201);

        const projectBDoc = await callController(DocumentController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: projectBId,
                file_name: 'Contrato Projeto B',
                file_url: 'https://example.com/projeto-b.pdf',
                provider: 'external',
                document_type: 'contract'
            }
        });
        assert.equal(projectBDoc.statusCode, 201);

        const globalTeamDoc = await callController(DocumentController.create, {
            userId: seeded.ownerId,
            body: {
                team_id: seeded.teamId,
                file_name: 'Pasta global do time',
                file_url: 'https://example.com/time.pdf',
                provider: 'external',
                document_type: 'folder'
            }
        });
        assert.equal(globalTeamDoc.statusCode, 201);

        const privateOutsideDoc = await callController(DocumentController.create, {
            userId: seeded.outsideId,
            body: {
                file_name: 'Documento privado externo',
                file_url: 'https://example.com/privado.pdf',
                provider: 'external',
                document_type: 'other'
            }
        });
        assert.equal(privateOutsideDoc.statusCode, 201);

        const archivedProjectADoc = await callController(DocumentController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                file_name: 'Briefing arquivado A',
                file_url: 'https://example.com/a-arquivado.pdf',
                provider: 'external',
                document_type: 'briefing'
            }
        });
        assert.equal(archivedProjectADoc.statusCode, 201);
        await callController(DocumentController.archive, {
            userId: seeded.ownerId,
            params: { id: archivedProjectADoc.body.id }
        });

        const invoiceA = await callController(InvoiceController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: seeded.projectId,
                client_name: 'Cliente Compartilhado',
                amount: 1000,
                issue_date: '2026-05-20',
                status: 'emitida'
            }
        });
        assert.equal(invoiceA.statusCode, 201);

        const invoiceB = await callController(InvoiceController.create, {
            userId: seeded.ownerId,
            body: {
                project_id: projectBId,
                client_name: 'Cliente Compartilhado',
                amount: 2000,
                issue_date: '2026-05-21',
                status: 'emitida'
            }
        });
        assert.equal(invoiceB.statusCode, 201);

        const invoiceADoc = await callController(DocumentController.create, {
            userId: seeded.ownerId,
            body: {
                invoice_id: invoiceA.body.id,
                file_name: 'PDF NF Projeto A',
                file_url: 'https://example.com/nf-a.pdf',
                provider: 'external',
                document_type: 'invoice'
            }
        });
        assert.equal(invoiceADoc.statusCode, 201);

        const invoiceBDoc = await callController(DocumentController.create, {
            userId: seeded.ownerId,
            body: {
                invoice_id: invoiceB.body.id,
                file_name: 'PDF NF Projeto B',
                file_url: 'https://example.com/nf-b.pdf',
                provider: 'external',
                document_type: 'invoice'
            }
        });
        assert.equal(invoiceBDoc.statusCode, 201);

        const legacyInvoiceADoc = await db.run(`
            INSERT INTO documents (user_id, team_id, invoice_id, file_name, file_url, provider, document_type, archived)
            VALUES (?, ?, ?, 'PDF legado NF A', 'https://example.com/nf-a-legado.pdf', 'external', 'invoice', 0)
        `, [seeded.ownerId, seeded.teamId, invoiceA.body.id]);

        const legacyInvoiceBDoc = await db.run(`
            INSERT INTO documents (user_id, team_id, invoice_id, file_name, file_url, provider, document_type, archived)
            VALUES (?, ?, ?, 'PDF legado NF B', 'https://example.com/nf-b-legado.pdf', 'external', 'invoice', 0)
        `, [seeded.ownerId, seeded.teamId, invoiceB.body.id]);

        for (const userId of [seeded.ownerId, seeded.adminId, seeded.gestorId]) {
            const projectADocs = await callController(DocumentController.byProject, {
                userId,
                params: { id: seeded.projectId },
                query: {}
            });

            assert.equal(projectADocs.statusCode, 200);
            const ids = projectADocs.body.map(document => document.id);
            assert.equal(ids.includes(projectADoc.body.id), true);
            assert.equal(ids.includes(invoiceADoc.body.id), true);
            assert.equal(ids.includes(legacyInvoiceADoc.lastID), true);
            assert.equal(ids.includes(projectBDoc.body.id), false);
            assert.equal(ids.includes(invoiceBDoc.body.id), false);
            assert.equal(ids.includes(legacyInvoiceBDoc.lastID), false);
            assert.equal(ids.includes(globalTeamDoc.body.id), false);
            assert.equal(ids.includes(privateOutsideDoc.body.id), false);
            assert.equal(ids.includes(archivedProjectADoc.body.id), false);
        }

        const archivedProjectADocs = await callController(DocumentController.byProject, {
            userId: seeded.adminId,
            params: { id: seeded.projectId },
            query: { status: 'archived' }
        });
        assert.equal(archivedProjectADocs.statusCode, 200);
        assert.equal(archivedProjectADocs.body.some(document => document.id === archivedProjectADoc.body.id), true);
        assert.equal(archivedProjectADocs.body.some(document => document.id === projectBDoc.body.id), false);
    } finally {
        await cleanup();
    }
});

test('financeiro role sees only explicitly authorized project financials', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedTeamProject(db);

        await db.run(
            "INSERT INTO team_members (team_id, user_id, email, role, status) VALUES (?, ?, 'outside@test.local', 'financeiro', 'active')",
            [seeded.teamId, seeded.outsideId]
        );

        assert.equal(await canViewTeamResource(db, seeded.outsideId, seeded.teamId), true);
        assert.equal(await canViewProjectFinancials(db, seeded.outsideId, seeded.projectId), false);

        await db.run(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'financeiro')",
            [seeded.projectId, seeded.outsideId]
        );

        assert.equal(await canViewProjectFinancials(db, seeded.outsideId, seeded.projectId), true);

        const projectSummary = await callController(ProjectFinancialController.summary, {
            userId: seeded.outsideId,
            params: { id: seeded.projectId }
        });
        assert.equal(projectSummary.statusCode, 200);
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

test('personal summary returns zero fallback for user without transactions', async () => {
    const { db, cleanup } = await openTestDb();
    try {
        const seeded = await seedUsers(db);

        const summary = await callController(PersonalTransactionController.summary, {
            userId: seeded.ownerId,
            query: { month: '05', year: '2026' }
        });

        assert.equal(summary.statusCode, 200);
        assert.equal(summary.body.bank_balance, 0);
        assert.equal(summary.body.gross_revenue_total, 0);
        assert.equal(summary.body.expected_month, 0);
        assert.equal(summary.body.received, 0);
        assert.equal(summary.body.personal_expenses, 0);
        assert.equal(summary.body.work_expenses, 0);
        assert.equal(summary.body.transfers, 0);
        assert.equal(summary.body.own_amount, 0);
        assert.equal(summary.body.projected_balance, 0);
        assert.equal(summary.body.personal_projected_balance, 0);
        assert.equal(summary.body.recurring_expenses, 0);
        assert.equal(summary.body.total_debt, 0);
        assert.equal(summary.body.current_card_bill, 0);
        assert.equal(summary.body.fixed_installments, 0);
        assert.equal(summary.body.saldo_bancos, 0);
        assert.equal(summary.body.faturamento_total, 0);
        assert.equal(summary.body.previsto_mes, 0);
        assert.equal(summary.body.saldo_previsto, 0);
    } finally {
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
                gross_amount: 4800,
                own_amount: 1400,
                transfer_amount: 3400,
                date: '2026-05-10',
                payment_due_date: '2026-06-10',
                status: 'paid',
                source: 'manual',
                origin_label: 'Freelance',
                financial_type: 'revenue'
            }
        });
        assert.equal(income.statusCode, 201);

        const expectedInAnotherMonth = await callController(PersonalTransactionController.create, {
            userId: seeded.ownerId,
            body: {
                type: 'income',
                description: 'NF com vencimento em junho',
                category: 'Projeto',
                amount: 600,
                date: '2026-05-20',
                payment_due_date: '2026-06-15',
                status: 'expected',
                source: 'project',
                financial_type: 'revenue'
            }
        });
        assert.equal(expectedInAnotherMonth.statusCode, 201);

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

        const gympass = await callController(PersonalTransactionController.create, {
            userId: seeded.ownerId,
            body: {
                type: 'expense',
                description: 'Gympass',
                category: 'Academia',
                amount: 136,
                date: '2026-05-12',
                payment_due_date: '2026-05-12',
                status: 'paid',
                payment_method: 'Cartao',
                source: 'manual',
                financial_type: 'personal_expense',
                financial_scope: 'personal',
                is_recurring: 1,
                recurrence_frequency: 'monthly'
            }
        });
        assert.equal(gympass.statusCode, 201);

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
            query: { type: 'income', status: 'paid', month: '06', year: '2026' }
        });
        assert.equal(ownerIncomeList.statusCode, 200);
        assert.equal(ownerIncomeList.body.length, 1);
        assert.equal(ownerIncomeList.body[0].id, income.body.id);
        assert.equal(ownerIncomeList.body[0].source, 'manual');
        assert.equal(ownerIncomeList.body[0].origin_type, 'manual');
        assert.equal(ownerIncomeList.body[0].origin_label, 'Freelance');

        const manualIncomeList = await callController(PersonalTransactionController.index, {
            userId: seeded.ownerId,
            query: { source: 'manual', month: '06', year: '2026' }
        });
        assert.equal(manualIncomeList.statusCode, 200);
        assert.equal(manualIncomeList.body.length, 1);
        assert.equal(manualIncomeList.body[0].origin_label, 'Freelance');

        const personalExpenseList = await callController(PersonalTransactionController.index, {
            userId: seeded.ownerId,
            query: { financial_scope: 'personal', financial_type: 'personal_expense', is_recurring: '1', month: '05', year: '2026' }
        });
        assert.equal(personalExpenseList.statusCode, 200);
        assert.equal(personalExpenseList.body.length, 2);
        assert.equal(personalExpenseList.body.some(item => item.description === 'Gympass'), true);
        assert.equal(personalExpenseList.body.find(item => item.description === 'Gympass').project_id, null);

        const memberCannotEdit = await callController(PersonalTransactionController.update, {
            userId: seeded.memberId,
            params: { id: income.body.id },
            body: { description: 'Nao pode editar' }
        });
        assert.equal(memberCannotEdit.statusCode, 404);

        const ownerEdit = await callController(PersonalTransactionController.update, {
            userId: seeded.ownerId,
            params: { id: expense.body.id },
            body: { status: 'paid', amount: 250, source: 'manual', origin_label: 'PIX recebido' }
        });
        assert.equal(ownerEdit.statusCode, 200);

        const editedExpense = await db.get('SELECT source, origin_label FROM personal_transactions WHERE id = ?', [expense.body.id]);
        assert.equal(editedExpense.source, 'manual');
        assert.equal(editedExpense.origin_label, 'PIX recebido');

        const summary = await callController(PersonalTransactionController.summary, {
            userId: seeded.ownerId,
            query: { month: '05', year: '2026' }
        });
        assert.equal(summary.statusCode, 200);
        assert.equal(summary.body.bank_balance, 1000);
        assert.equal(summary.body.total_income_month, 2100);
        assert.equal(summary.body.total_expense_month, 386);
        assert.equal(summary.body.gross_revenue_period, 5400);
        assert.equal(summary.body.expected_month, 0);
        assert.equal(summary.body.transfers, 3400);
        assert.equal(summary.body.own_amount, 2000);
        assert.equal(summary.body.personal_expenses, 386);
        assert.equal(summary.body.work_expenses, 0);
        assert.equal(summary.body.recurring_expenses, 386);
        assert.equal(summary.body.personal_projected_balance, 2714);
        assert.equal(summary.body.projected_balance, 2714);
        assert.equal(summary.body.total_debt, 2000);
        assert.equal(summary.body.current_card_bill, 350);

        const juneSummary = await callController(PersonalTransactionController.summary, {
            userId: seeded.ownerId,
            query: { month: '06', year: '2026' }
        });
        assert.equal(juneSummary.statusCode, 200);
        assert.equal(juneSummary.body.expected_month, 2100);

        const archived = await callController(PersonalTransactionController.destroy, {
            userId: seeded.ownerId,
            params: { id: expense.body.id }
        });
        assert.equal(archived.statusCode, 200);

        const afterArchive = await callController(PersonalTransactionController.index, {
            userId: seeded.ownerId,
            query: { type: 'expense', month: '05', year: '2026' }
        });
        assert.equal(afterArchive.body.length, 1);
        assert.equal(afterArchive.body[0].description, 'Gympass');
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
