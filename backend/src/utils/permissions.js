const TEAM_ROLES = ['owner', 'admin', 'gestor', 'financeiro', 'member'];
const TEAM_MANAGERS = ['owner', 'admin'];
const TEAM_EDITORS = ['owner', 'admin', 'gestor'];
const FINANCIAL_ROLES = ['owner', 'admin', 'gestor', 'financeiro'];

async function getUser(db, userId) {
    if (!userId) return null;
    return db.get('SELECT id, plan, role, is_super_admin FROM users WHERE id = ?', [userId]);
}

async function isSuperAdmin(db, userId) {
    const user = await getUser(db, userId);
    return user?.is_super_admin === 1 || user?.role === 'super_admin';
}

function isProjectOwner(project, userId) {
    const normalizedUserId = Number(userId);
    return ['user_id', 'owner_id', 'created_by'].some(field => (
        project[field] !== undefined
        && project[field] !== null
        && Number(project[field]) === normalizedUserId
    ));
}

async function getTeamRole(db, userId, teamId) {
    if (!teamId) return null;

    const membership = await db.get(`
        SELECT role
        FROM team_members
        WHERE team_id = ? AND user_id = ? AND status = 'active'
    `, [teamId, userId]);

    return membership?.role || null;
}

async function isTeamMember(db, userId, teamId) {
    return Boolean(await getTeamRole(db, userId, teamId));
}

async function canManageTeam(db, userId, teamId) {
    if (await isSuperAdmin(db, userId)) return true;
    const role = await getTeamRole(db, userId, teamId);
    return TEAM_MANAGERS.includes(role);
}

async function canManageTeamMembers(db, userId, teamId) {
    return canManageTeam(db, userId, teamId);
}

async function canEditTeamResource(db, userId, teamId) {
    if (await isSuperAdmin(db, userId)) return true;
    const role = await getTeamRole(db, userId, teamId);
    return TEAM_EDITORS.includes(role);
}

async function canViewTeamResource(db, userId, teamId) {
    if (await isSuperAdmin(db, userId)) return true;
    return isTeamMember(db, userId, teamId);
}

async function canCreateTeam() {
    return true;
}

async function canEditTeam(db, userId, teamId) {
    return canManageTeam(db, userId, teamId);
}

async function canArchiveTeam(db, userId, teamId) {
    if (await isSuperAdmin(db, userId)) return true;
    const role = await getTeamRole(db, userId, teamId);
    return role === 'owner';
}

async function canInviteTeamMember(db, userId, teamId) {
    return canManageTeamMembers(db, userId, teamId);
}

async function canChangeTeamRole(db, userId, teamId, targetRole = null) {
    const actorRole = await getTeamRole(db, userId, teamId);
    if (await isSuperAdmin(db, userId)) return targetRole !== 'owner';
    if (!TEAM_MANAGERS.includes(actorRole)) return false;
    if (targetRole === 'owner') return false;
    return true;
}

async function canViewClient(db, userId, client) {
    if (!client) return false;
    if (Number(client.user_id) === Number(userId)) return true;
    if (client.team_id) return canViewTeamResource(db, userId, client.team_id);
    return false;
}

async function canViewClientSensitiveData(db, userId, client) {
    if (!client) return false;
    if (Number(client.user_id) === Number(userId)) return true;
    if (!client.team_id) return false;
    const role = await getTeamRole(db, userId, client.team_id);
    if (await isSuperAdmin(db, userId)) return true;
    return ['owner', 'admin', 'gestor', 'financeiro'].includes(role);
}

async function canEditClient(db, userId, client) {
    if (!client) return false;
    if (Number(client.user_id) === Number(userId)) return true;
    if (client.team_id) return canEditTeamResource(db, userId, client.team_id);
    return false;
}

function sanitizeClientForRole(client, canViewSensitive = false) {
    if (!client || canViewSensitive) return client;
    return {
        ...client,
        email: null,
        phone: null,
        document: null,
        contact_name: null,
        sensitive_hidden: true
    };
}

async function getProjectAccess(db, userId, projectId) {
    const project = await db.get(`
        SELECT p.*, c.name as client_name, c.team_id as client_team_id, t.name as team_name
        FROM projects p
        JOIN clients c ON c.id = p.client_id
        LEFT JOIN teams t ON t.id = p.team_id
        WHERE p.id = ?
    `, [projectId]);

    if (!project) return null;

    const isIndividualProject = project.scope === 'individual' || !project.team_id;

    if (isProjectOwner(project, userId) || await isSuperAdmin(db, userId)) {
        return { ...project, access_role: 'owner', team_role: project.team_id ? await getTeamRole(db, userId, project.team_id) : null };
    }

    const directMember = await db.get(
        'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
        [projectId, userId]
    );

    if (directMember) {
        return { ...project, access_role: directMember.role || 'member', team_role: null };
    }

    if (isIndividualProject) {
        return null;
    }

    if (project.scope === 'team' && project.team_id) {
        const teamRole = await getTeamRole(db, userId, project.team_id);
        if (TEAM_EDITORS.includes(teamRole)) {
            return { ...project, access_role: teamRole, team_role: teamRole };
        }
    }

    return null;
}

async function canViewProjectFinancials(db, userId, projectId) {
    const project = await getProjectAccess(db, userId, projectId);
    if (!project) return false;
    return FINANCIAL_ROLES.includes(project.access_role);
}

async function canEditProjectFinancials(db, userId, projectId) {
    return canViewProjectFinancials(db, userId, projectId);
}

async function canViewOwnFinancialShare(db, userId, projectId) {
    return Boolean(await getProjectAccess(db, userId, projectId));
}

async function canCreateProject(db, userId, payload = {}) {
    if (payload.scope === 'team') return canEditTeamResource(db, userId, payload.team_id);
    return true;
}

async function canViewProject(db, userId, projectId) {
    return Boolean(await getProjectAccess(db, userId, projectId));
}

async function canEditProject(db, userId, projectId) {
    const project = await getProjectAccess(db, userId, projectId);
    if (!project) return false;
    return ['owner', 'admin', 'gestor'].includes(project.access_role);
}

async function canArchiveProject(db, userId, projectId) {
    return canEditProject(db, userId, projectId);
}

async function canRemoveProjectMember(db, userId, projectId) {
    const project = await getProjectAccess(db, userId, projectId);
    if (!project) return false;
    return ['owner', 'admin', 'gestor'].includes(project.access_role);
}

async function canRemoveTeamMember(db, userId, teamId, targetRole = null) {
    if (targetRole === 'owner') return false;
    return canManageTeamMembers(db, userId, teamId);
}

async function canTransferProjectOwnership(db, userId, projectId) {
    const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
    return Boolean(project && isProjectOwner(project, userId));
}

async function canViewPersonalFinance(db, userId, ownerUserId) {
    return Number(userId) === Number(ownerUserId);
}

async function canEditPersonalFinance(db, userId, ownerUserId) {
    return canViewPersonalFinance(db, userId, ownerUserId);
}

async function getDocumentPermission(db, userId, documentId) {
    return db.get(`
        SELECT *
        FROM document_permissions
        WHERE document_id = ?
          AND user_id = ?
          AND COALESCE(permission, role, 'view') IN ('view', 'viewer', 'edit', 'editor', 'manage')
    `, [documentId, userId]);
}

async function canViewDocument(db, userId, document) {
    if (!document) return false;
    if (Number(document.user_id) === Number(userId)) return true;
    if (await getDocumentPermission(db, userId, document.id)) return true;
    if (document.project_financial_entry_id) {
        const entry = await db.get('SELECT project_id, user_id, created_by FROM project_financial_entries WHERE id = ?', [document.project_financial_entry_id]);
        if (!entry) return false;
        if ([entry.user_id, entry.created_by].some(id => Number(id) === Number(userId))) return true;
        return canViewProjectFinancials(db, userId, entry.project_id);
    }
    if (document.project_id) return canViewProject(db, userId, document.project_id);
    if (document.client_id) {
        const client = await db.get('SELECT * FROM clients WHERE id = ?', [document.client_id]);
        if (!(await canViewClient(db, userId, client))) return false;
    }
    if (document.invoice_id) {
        const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [document.invoice_id]);
        return canViewInvoice(db, userId, invoice);
    }
    if (document.team_id) return canViewTeamResource(db, userId, document.team_id);
    return false;
}

async function canEditDocument(db, userId, document) {
    if (!document) return false;
    if (Number(document.user_id) === Number(userId)) return true;
    const explicit = await getDocumentPermission(db, userId, document.id);
    if (['edit', 'editor', 'manage'].includes(explicit?.permission || explicit?.role)) return true;
    if (document.project_financial_entry_id) {
        const entry = await db.get('SELECT project_id, user_id, created_by FROM project_financial_entries WHERE id = ?', [document.project_financial_entry_id]);
        if (!entry) return false;
        if ([entry.user_id, entry.created_by].some(id => Number(id) === Number(userId))) return true;
        return canEditProjectFinancials(db, userId, entry.project_id);
    }
    if (document.project_id) return canEditProject(db, userId, document.project_id);
    if (document.invoice_id) {
        const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [document.invoice_id]);
        return canEditInvoice(db, userId, invoice);
    }
    if (document.team_id) return canEditTeamResource(db, userId, document.team_id);
    return false;
}

async function canShareDocument(db, userId, document) {
    if (!document) return false;
    if (Number(document.user_id) === Number(userId)) return true;
    const explicit = await getDocumentPermission(db, userId, document.id);
    return (explicit?.permission || explicit?.role) === 'manage';
}

function sanitizeDocumentForRole(document) {
    return document;
}

function sanitizeProjectForRole(project, canViewFinancials = false) {
    if (!project || canViewFinancials) return project;
    return {
        ...project,
        base_value: null,
        amount_paid: null,
        payment_type: null,
        payment_status: null,
        total_value: null,
        remaining_balance: null,
        can_view_financials: false
    };
}

function sanitizeFinancialForRole(financial, canViewGlobal = false) {
    if (canViewGlobal) return financial;
    return {
        ...financial,
        total_value: null,
        allocation_total: null,
        unallocated_amount: null,
        can_view_global: false,
        shares: Array.isArray(financial?.shares) ? financial.shares.filter(share => share.is_self) : []
    };
}

async function canViewInvoice(db, userId, invoice) {
    if (!invoice) return false;
    if (Number(invoice.user_id) === Number(userId)) return true;
    if (invoice.project_id) return canViewProjectFinancials(db, userId, invoice.project_id);
    return false;
}

async function canEditInvoice(db, userId, invoice) {
    if (!invoice) return false;
    if (Number(invoice.user_id) === Number(userId)) return true;
    if (invoice.project_id) return canEditProjectFinancials(db, userId, invoice.project_id);
    return false;
}

function sanitizeInvoiceForRole(invoice, canViewSensitive = true) {
    if (!invoice || canViewSensitive) return invoice;
    return {
        ...invoice,
        amount: null,
        number: null,
        sensitive_hidden: true
    };
}

async function canViewTask(db, userId, task) {
    if (!task) return false;
    if ([task.user_id, task.created_by, task.assigned_to].some(id => Number(id) === Number(userId))) return true;
    if (task.task_type === 'financial' && task.project_id) return canViewProjectFinancials(db, userId, task.project_id);
    if (task.project_id) return canViewProject(db, userId, task.project_id);
    if (task.team_id) return canViewTeamResource(db, userId, task.team_id);
    return false;
}

async function canEditTask(db, userId, task) {
    if (!task) return false;
    if (Number(task.created_by) === Number(userId)) return true;
    if (!task.created_by && Number(task.user_id) === Number(userId)) return true;
    if (task.task_type === 'financial' && task.project_id) return canEditProjectFinancials(db, userId, task.project_id);
    if (task.project_id) return canEditProject(db, userId, task.project_id);
    if (task.team_id) return canEditTeamResource(db, userId, task.team_id);
    return false;
}

async function canCompleteTask(db, userId, task) {
    if (!task) return false;
    if (Number(task.assigned_to) === Number(userId)) return true;
    return canEditTask(db, userId, task);
}

async function canAssignTask(db, actorUserId, assignedTo, context = {}) {
    const numericAssignedTo = Number(assignedTo);
    if (!assignedTo || !Number.isInteger(numericAssignedTo) || numericAssignedTo <= 0) {
        return false;
    }

    const user = await getUser(db, numericAssignedTo);
    if (!user) return false;

    if (context.project) {
        if (isProjectOwner(context.project, numericAssignedTo)) return true;

        const projectMember = await db.get(
            'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
            [context.project.id, numericAssignedTo]
        );
        return Boolean(projectMember);
    }

    if (context.teamId) {
        const teamMember = await db.get(
            "SELECT id FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'",
            [context.teamId, numericAssignedTo]
        );
        return Boolean(teamMember);
    }

    return Number(actorUserId) === numericAssignedTo;
}

function sanitizeTaskForRole(task, canViewSensitive = false) {
    if (!task || canViewSensitive) return task;
    if (task.task_type !== 'financial') return task;

    return {
        ...task,
        financial_entry_id: null,
        invoice_id: null,
        sensitive_hidden: true
    };
}

function sanitizeUserForRole(user, canViewSensitive = false) {
    if (!user) return user;
    const sanitized = {
        id: user.id,
        name: user.name,
        role: user.role,
        plan: user.plan,
        is_super_admin: user.is_super_admin
    };

    if (canViewSensitive) {
        sanitized.email = user.email;
    }

    return sanitized;
}

module.exports = {
    getUser,
    isSuperAdmin,
    TEAM_ROLES,
    TEAM_MANAGERS,
    TEAM_EDITORS,
    FINANCIAL_ROLES,
    canArchiveProject,
    canArchiveTeam,
    canAssignTask,
    canChangeTeamRole,
    canCompleteTask,
    canCreateProject,
    canCreateTeam,
    canEditDocument,
    canEditInvoice,
    canEditClient,
    canEditPersonalFinance,
    canEditProject,
    canEditProjectFinancials,
    canEditTask,
    canEditTeam,
    canEditTeamResource,
    canInviteTeamMember,
    canManageTeam,
    canManageTeamMembers,
    canRemoveProjectMember,
    canRemoveTeamMember,
    canShareDocument,
    canTransferProjectOwnership,
    canViewClient,
    canViewClientSensitiveData,
    canViewDocument,
    canViewInvoice,
    canViewOwnFinancialShare,
    canViewPersonalFinance,
    canViewProject,
    canViewProjectFinancials,
    canViewTask,
    canViewTeamResource,
    getProjectAccess,
    getTeamRole,
    isProjectOwner,
    isTeamMember,
    sanitizeClientForRole,
    sanitizeDocumentForRole,
    sanitizeFinancialForRole,
    sanitizeInvoiceForRole,
    sanitizeProjectForRole,
    sanitizeTaskForRole,
    sanitizeUserForRole
};
