const TEAM_ROLES = ['owner', 'admin', 'gestor', 'member'];
const TEAM_MANAGERS = ['owner', 'admin'];
const TEAM_EDITORS = ['owner', 'admin', 'gestor'];
const FINANCIAL_ROLES = ['owner', 'admin', 'gestor'];

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
    const role = await getTeamRole(db, userId, teamId);
    return TEAM_MANAGERS.includes(role);
}

async function canManageTeamMembers(db, userId, teamId) {
    return canManageTeam(db, userId, teamId);
}

async function canEditTeamResource(db, userId, teamId) {
    const role = await getTeamRole(db, userId, teamId);
    return TEAM_EDITORS.includes(role);
}

async function canViewTeamResource(db, userId, teamId) {
    return isTeamMember(db, userId, teamId);
}

async function getProjectAccess(db, userId, projectId) {
    const project = await db.get(`
        SELECT p.*, c.name as client_name, c.team_id as client_team_id
        FROM projects p
        JOIN clients c ON c.id = p.client_id
        WHERE p.id = ?
    `, [projectId]);

    if (!project) return null;

    if (project.user_id === userId) {
        return { ...project, access_role: 'owner', team_role: project.team_id ? await getTeamRole(db, userId, project.team_id) : null };
    }

    const directMember = await db.get(
        'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
        [projectId, userId]
    );

    if (directMember) {
        return { ...project, access_role: directMember.role || 'member', team_role: null };
    }

    const teamId = project.team_id || project.client_team_id;
    if (teamId) {
        const teamRole = await getTeamRole(db, userId, teamId);
        if (teamRole) {
            return { ...project, team_id: teamId, access_role: teamRole, team_role: teamRole };
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

module.exports = {
    TEAM_ROLES,
    TEAM_MANAGERS,
    TEAM_EDITORS,
    FINANCIAL_ROLES,
    canEditProjectFinancials,
    canEditTeamResource,
    canManageTeam,
    canManageTeamMembers,
    canViewOwnFinancialShare,
    canViewProjectFinancials,
    canViewTeamResource,
    getProjectAccess,
    getTeamRole,
    isTeamMember
};
