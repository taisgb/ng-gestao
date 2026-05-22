const TEAM_ROLES = ['owner', 'admin', 'gestor', 'financeiro', 'member'];
const TEAM_MANAGERS = ['owner', 'admin'];
const TEAM_EDITORS = ['owner', 'admin', 'gestor'];
const FINANCIAL_ROLES = ['owner', 'admin', 'gestor', 'financeiro'];
const PROJECT_BILLING_MODES = ['centralized', 'split_private', 'shared'];
const PROJECT_FINANCIAL_VISIBILITIES = ['private_owner', 'shared_authorized', 'shared_project'];
const PRIVATE_FINANCIAL_VISIBILITIES = ['private', 'shared_with_owner', 'shared_with_financial_manager', 'shared_with_project'];
const PROJECT_PERMISSION_FIELDS = [
    'can_edit_project',
    'can_manage_status',
    'can_manage_warranty',
    'can_view_tasks',
    'can_create_tasks',
    'can_manage_tasks',
    'can_view_documents',
    'can_upload_documents',
    'can_view_shared_invoices',
    'can_view_shared_financials',
    'can_create_revenue',
    'can_create_expense',
    'can_manage_financial_entries',
    'can_view_own_transfer',
    'can_manage_members'
];

const PROJECT_PERMISSION_PROFILES = {
    operational: {
        can_edit_project: 0,
        can_manage_status: 0,
        can_manage_warranty: 0,
        can_view_tasks: 1,
        can_create_tasks: 0,
        can_manage_tasks: 0,
        can_view_documents: 1,
        can_upload_documents: 0,
        can_view_shared_invoices: 0,
        can_view_shared_financials: 0,
        can_create_revenue: 0,
        can_create_expense: 0,
        can_manage_financial_entries: 0,
        can_view_own_transfer: 1,
        can_manage_members: 0
    },
    manager: {
        can_edit_project: 1,
        can_manage_status: 1,
        can_manage_warranty: 1,
        can_view_tasks: 1,
        can_create_tasks: 1,
        can_manage_tasks: 1,
        can_view_documents: 1,
        can_upload_documents: 1,
        can_view_shared_invoices: 0,
        can_view_shared_financials: 0,
        can_create_revenue: 0,
        can_create_expense: 0,
        can_manage_financial_entries: 0,
        can_view_own_transfer: 1,
        can_manage_members: 0
    },
    financial: {
        can_edit_project: 0,
        can_manage_status: 0,
        can_manage_warranty: 0,
        can_view_tasks: 1,
        can_create_tasks: 0,
        can_manage_tasks: 0,
        can_view_documents: 1,
        can_upload_documents: 1,
        can_view_shared_invoices: 1,
        can_view_shared_financials: 1,
        can_create_revenue: 1,
        can_create_expense: 1,
        can_manage_financial_entries: 0,
        can_view_own_transfer: 1,
        can_manage_members: 0
    },
    owner: Object.fromEntries(PROJECT_PERMISSION_FIELDS.map(field => [field, 1]))
};

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

function toBoolInt(value) {
    return value === true || value === 1 || value === '1' ? 1 : 0;
}

function projectProfileForRole(role) {
    if (role === 'owner') return 'owner';
    if (role === 'gestor' || role === 'admin') return 'manager';
    if (role === 'financeiro') return 'financial';
    return 'operational';
}

function resolveProjectMemberPermissions(member = {}) {
    const roleProfile = projectProfileForRole(member.role);
    const storedProfile = member.permission_profile || roleProfile;
    const profile = PROJECT_PERMISSION_PROFILES[storedProfile] ? storedProfile : roleProfile;
    const base = PROJECT_PERMISSION_PROFILES[profile] || PROJECT_PERMISSION_PROFILES.operational;
    const permissions = {};

    PROJECT_PERMISSION_FIELDS.forEach(field => {
        permissions[field] = member[field] === undefined || member[field] === null
            ? toBoolInt(base[field])
            : toBoolInt(member[field]);
    });

    if (member.role === 'owner') {
        PROJECT_PERMISSION_FIELDS.forEach(field => {
            permissions[field] = 1;
        });
        return { profile: 'owner', ...permissions };
    }

    return { profile, ...permissions };
}

async function getProjectMemberPermissionRow(db, userId, projectId) {
    return db.get('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
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

    const directMember = await getProjectMemberPermissionRow(db, userId, projectId);

    if (directMember) {
        return {
            ...project,
            ...resolveProjectMemberPermissions(directMember),
            access_role: directMember.role || 'member',
            team_role: null
        };
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
    const visibility = project.financial_visibility || 'shared_authorized';
    if (visibility === 'private_owner') {
        return project.access_role === 'owner' || isProjectOwner(project, userId);
    }
    if (visibility === 'shared_project') {
        return true;
    }
    return FINANCIAL_ROLES.includes(project.access_role)
        || project.can_view_shared_financials === 1
        || project.can_manage_financial_entries === 1;
}

async function canEditProjectFinancials(db, userId, projectId) {
    const project = await getProjectAccess(db, userId, projectId);
    if (!project) return false;
    if (['owner', 'admin', 'financeiro'].includes(project.access_role)) return true;
    if (project.access_role === 'gestor' && !project.team_role) return true;
    return project.can_manage_financial_entries === 1
        || project.can_create_revenue === 1
        || project.can_create_expense === 1;
}

async function canViewOwnFinancialShare(db, userId, projectId) {
    return Boolean(await getProjectAccess(db, userId, projectId));
}

async function canViewPrivateProjectMemberFinancialEntry(db, userId, entry) {
    if (!entry) return false;
    if (Number(entry.user_id) === Number(userId) || Number(entry.created_by) === Number(userId)) return true;
    if (!entry.project_id) return false;

    const project = await getProjectAccess(db, userId, entry.project_id);
    if (!project) return false;

    const visibility = entry.visibility || 'private';
    if (visibility === 'shared_with_project') return canViewProject(db, userId, entry.project_id);
    if (visibility === 'shared_with_owner' || entry.shared_with_project_owner === 1) {
        return project.access_role === 'owner' || isProjectOwner(project, userId);
    }
    if (visibility === 'shared_with_financial_manager') {
        return canViewProjectFinancials(db, userId, entry.project_id);
    }
    return false;
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
    return ['owner', 'admin', 'gestor'].includes(project.access_role) || project.can_edit_project === 1;
}

async function canArchiveProject(db, userId, projectId) {
    return canEditProject(db, userId, projectId);
}

async function canRemoveProjectMember(db, userId, projectId) {
    const project = await getProjectAccess(db, userId, projectId);
    if (!project) return false;
    return ['owner', 'admin'].includes(project.access_role) || project.can_manage_members === 1;
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
    if ((document.document_visibility || 'shared_with_project') === 'private') return false;
    if (document.project_financial_entry_id) {
        const entry = await db.get('SELECT project_id, user_id, created_by FROM project_financial_entries WHERE id = ?', [document.project_financial_entry_id]);
        if (!entry) return false;
        if ([entry.user_id, entry.created_by].some(id => Number(id) === Number(userId))) return true;
        return canViewProjectFinancials(db, userId, entry.project_id);
    }
    if (document.project_id) {
        if (document.document_visibility === 'shared_with_financial_manager') {
            return canViewProjectFinancials(db, userId, document.project_id);
        }
        return canViewProject(db, userId, document.project_id);
    }
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
    if (document.project_id) {
        const project = await getProjectAccess(db, userId, document.project_id);
        return Boolean(project && (project.can_upload_documents === 1 || await canEditProject(db, userId, document.project_id)));
    }
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
        updated_value: null,
        received_amount: null,
        pending_amount: null,
        net_balance: null,
        margin: null,
        transfers: null,
        own_amount: null,
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
    if ((invoice.invoice_visibility || 'shared_with_financial_manager') === 'private') return false;
    if (invoice.project_id) {
        if (invoice.invoice_visibility === 'shared_with_project') return canViewProject(db, userId, invoice.project_id);
        return canViewProjectFinancials(db, userId, invoice.project_id);
    }
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
    if (task.project_id) {
        const project = await getProjectAccess(db, userId, task.project_id);
        return Boolean(project && (project.can_manage_tasks === 1 || await canEditProject(db, userId, task.project_id)));
    }
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
    PRIVATE_FINANCIAL_VISIBILITIES,
    PROJECT_BILLING_MODES,
    PROJECT_FINANCIAL_VISIBILITIES,
    PROJECT_PERMISSION_FIELDS,
    PROJECT_PERMISSION_PROFILES,
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
    canViewPrivateProjectMemberFinancialEntry,
    canViewPersonalFinance,
    canViewProject,
    canViewProjectFinancials,
    canViewTask,
    canViewTeamResource,
    getProjectAccess,
    getProjectMemberPermissionRow,
    getTeamRole,
    isProjectOwner,
    isTeamMember,
    projectProfileForRole,
    resolveProjectMemberPermissions,
    sanitizeClientForRole,
    sanitizeDocumentForRole,
    sanitizeFinancialForRole,
    sanitizeInvoiceForRole,
    sanitizeProjectForRole,
    sanitizeTaskForRole,
    sanitizeUserForRole
};
