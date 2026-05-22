const connectDb = require('../config/database');
const { isNonEmptyString } = require('../utils/validators');
const {
    canEditProjectFinancials,
    canEditDocument,
    canEditTeamResource,
    canShareDocument,
    canEditInvoice,
    canViewInvoice,
    canViewDocument,
    canViewProjectFinancials,
    canViewTeamResource,
    getProjectAccess,
    sanitizeDocumentForRole
} = require('../utils/permissions');
const { logActivity } = require('../utils/activityLog');

const PROVIDERS = ['drive', 'external', 'other'];
const TYPES = ['invoice', 'receipt', 'contract', 'briefing', 'artwork', 'image', 'boleto', 'folder', 'other'];

function isUrl(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

function normalizeStatus(status) {
    return ['active', 'archived', 'all'].includes(status) ? status : 'active';
}

function normalizeSearch(value) {
    return String(value || '').trim().slice(0, 120);
}

async function getClientAccess(db, clientId, userId) {
    if (!clientId) return null;
    const client = await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
    if (!client) return null;
    if (!client.team_id) return client.user_id === userId ? { can_view: true, can_edit: true, team_id: null } : null;
    const canView = await canViewTeamResource(db, userId, client.team_id);
    if (!canView) return null;
    return {
        can_view: true,
        can_edit: await canEditTeamResource(db, userId, client.team_id),
        team_id: client.team_id
    };
}

async function getInvoiceAccess(db, invoiceId, userId) {
    if (!invoiceId) return null;
    const invoice = await db.get(`
        SELECT i.*, p.team_id
        FROM invoices i
        LEFT JOIN projects p ON p.id = i.project_id
        WHERE i.id = ?
    `, [invoiceId]);
    if (!invoice) return null;
    const canView = await canViewInvoice(db, userId, invoice);
    if (!canView) return null;
    return {
        can_view: true,
        can_edit: await canEditInvoice(db, userId, invoice),
        project_id: invoice.project_id || null,
        team_id: invoice.team_id || null
    };
}

async function getFinancialEntryAccess(db, entryId, userId) {
    if (!entryId) return null;
    const entry = await db.get('SELECT * FROM project_financial_entries WHERE id = ? AND archived = 0', [entryId]);
    if (!entry) return null;
    if (entry.user_id === userId || entry.created_by === userId) {
        return { can_view: true, can_edit: true, project_id: entry.project_id, team_id: entry.team_id || null };
    }
    const canView = await canViewProjectFinancials(db, userId, entry.project_id);
    if (!canView) return null;
    return {
        can_view: true,
        can_edit: await canEditProjectFinancials(db, userId, entry.project_id),
        project_id: entry.project_id,
        team_id: entry.team_id || null
    };
}

async function getDocumentAccess(db, documentId, userId) {
    const document = await db.get(`
        SELECT d.*, t.name as team_name, c.name as client_name, p.title as project_title, i.number as invoice_number
        FROM documents d
        LEFT JOIN teams t ON t.id = d.team_id
        LEFT JOIN clients c ON c.id = d.client_id
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN invoices i ON i.id = d.invoice_id
        WHERE d.id = ?
    `, [documentId]);

    if (!document) return null;
    if (!await canViewDocument(db, userId, document)) return null;
    return {
        ...document,
        can_view: true,
        can_edit: await canEditDocument(db, userId, document)
    };
}

async function resolveAccess(db, userId, payload) {
    let inferredTeamId = payload.team_id || null;

    if (payload.team_id) {
        const canViewTeam = await canViewTeamResource(db, userId, payload.team_id);
        if (!canViewTeam) return { can_view: false, can_edit: false };
    }

    if (payload.project_financial_entry_id) {
        const access = await getFinancialEntryAccess(db, payload.project_financial_entry_id, userId);
        if (!access) return { can_view: false, can_edit: false };
        inferredTeamId = inferredTeamId || access.team_id || null;
        return {
            can_view: true,
            can_edit: access.can_edit,
            inferred_team_id: inferredTeamId,
            inferred_project_id: access.project_id || null
        };
    }

    if (payload.project_id) {
        const project = await getProjectAccess(db, userId, payload.project_id);
        if (!project) return { can_view: false, can_edit: false };
        inferredTeamId = inferredTeamId || project.team_id || project.client_team_id || null;
        return {
            can_view: true,
            can_edit: ['owner', 'admin', 'gestor'].includes(project.access_role),
            inferred_team_id: inferredTeamId,
            inferred_project_id: payload.project_id
        };
    }

    if (payload.client_id) {
        const clientAccess = await getClientAccess(db, payload.client_id, userId);
        if (!clientAccess) return { can_view: false, can_edit: false };
        inferredTeamId = inferredTeamId || clientAccess.team_id || null;
        return { can_view: true, can_edit: clientAccess.can_edit, inferred_team_id: inferredTeamId };
    }

    if (payload.invoice_id) {
        const invoiceAccess = await getInvoiceAccess(db, payload.invoice_id, userId);
        if (!invoiceAccess) return { can_view: false, can_edit: false };
        inferredTeamId = inferredTeamId || invoiceAccess.team_id || null;
        return {
            can_view: true,
            can_edit: invoiceAccess.can_edit,
            inferred_team_id: inferredTeamId,
            inferred_project_id: invoiceAccess.project_id || null
        };
    }

    if (payload.team_id) {
        const canView = await canViewTeamResource(db, userId, payload.team_id);
        if (!canView) return { can_view: false, can_edit: false };
        return {
            can_view: true,
            can_edit: await canEditTeamResource(db, userId, payload.team_id),
            inferred_team_id: payload.team_id
        };
    }

    return {
        can_view: payload.user_id === userId || payload.user_id === undefined,
        can_edit: payload.user_id === userId || payload.user_id === undefined,
        inferred_team_id: null
    };
}

function validatePayload(body, partial = false) {
    if (!partial || body.file_name !== undefined) {
        if (!isNonEmptyString(body.file_name, 180)) return 'Nome do documento é obrigatório.';
    }
    if (!partial || body.file_url !== undefined) {
        if (!isNonEmptyString(body.file_url, 1000) || !isUrl(body.file_url)) return 'Link do documento inválido.';
    }
    if (body.provider !== undefined && !PROVIDERS.includes(body.provider)) return 'Provider inválido.';
    if (body.document_type !== undefined && !TYPES.includes(body.document_type)) return 'Tipo de documento inválido.';
    return null;
}

module.exports = {
    _resolveAccess: resolveAccess,

    async index(req, res) {
        try {
            const db = await connectDb();
            const status = normalizeStatus(req.query.status);
            const filters = ['team_id', 'client_id', 'project_id', 'invoice_id', 'document_type', 'provider'];
            const params = [req.userId, req.userId, req.userId, status, status, status];
            const search = normalizeSearch(req.query.search || req.query.q);
            let query = `
                SELECT d.*, t.name as team_name, c.name as client_name, p.title as project_title, i.number as invoice_number,
                       CASE
                           WHEN d.team_id IS NULL AND d.user_id = ? THEN 1
                           WHEN tm.role IN ('owner', 'admin', 'gestor') THEN 1
                           WHEN COALESCE(dp.permission, dp.role) IN ('edit', 'manage') THEN 1
                           ELSE 0
                       END as can_edit
                FROM documents d
                LEFT JOIN teams t ON t.id = d.team_id
                LEFT JOIN clients c ON c.id = d.client_id
                LEFT JOIN projects p ON p.id = d.project_id
                LEFT JOIN invoices i ON i.id = d.invoice_id
                LEFT JOIN team_members tm ON tm.team_id = d.team_id AND tm.user_id = ? AND tm.status = 'active'
                LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = ?
                WHERE (
                    (? = 'active' AND d.archived = 0)
                    OR (? = 'archived' AND d.archived = 1)
                    OR ? = 'all'
                )
                AND ((d.team_id IS NULL AND d.user_id = ?) OR tm.user_id IS NOT NULL OR dp.user_id IS NOT NULL)
            `;
            params.push(req.userId);

            for (const filter of filters) {
                if (req.query[filter]) {
                    query += ` AND d.${filter} = ?`;
                    params.push(req.query[filter]);
                }
            }

            if (search) {
                query += `
                    AND (
                        LOWER(d.file_name) LIKE LOWER(?)
                        OR LOWER(COALESCE(d.description, '')) LIKE LOWER(?)
                        OR LOWER(COALESCE(d.file_url, '')) LIKE LOWER(?)
                        OR LOWER(COALESCE(c.name, '')) LIKE LOWER(?)
                        OR LOWER(COALESCE(p.title, '')) LIKE LOWER(?)
                        OR LOWER(COALESCE(i.number, '')) LIKE LOWER(?)
                    )
                `;
                const searchParam = `%${search}%`;
                params.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
            }

            query += ' ORDER BY d.created_at DESC, d.id DESC';

            const documents = await db.all(query, params);
            const visibleDocuments = [];
            for (const document of documents) {
                if (await canViewDocument(db, req.userId, document)) {
                    visibleDocuments.push(sanitizeDocumentForRole({
                        ...document,
                        can_edit: await canEditDocument(db, req.userId, document)
                    }));
                }
            }

            return res.json(visibleDocuments);
        } catch (error) {
            console.error('[DocumentController.index]', error);
            return res.status(500).json({ error: 'Erro ao listar documentos.' });
        }
    },

    async create(req, res) {
        try {
            const validationError = validatePayload(req.body);
            if (validationError) return res.status(400).json({ error: validationError });

            const db = await connectDb();
            const access = await resolveAccess(db, req.userId, req.body);
            if (!access.can_view || !access.can_edit) {
                return res.status(403).json({ error: 'Sem permissão para criar documento neste contexto.' });
            }

            const teamId = req.body.team_id || access.inferred_team_id || null;
            const projectId = req.body.project_id || access.inferred_project_id || null;
            const documentVisibility = ['private', 'shared_with_financial_manager', 'shared_with_project'].includes(req.body.document_visibility)
                ? req.body.document_visibility
                : 'shared_with_project';
            const result = await db.run(`
                INSERT INTO documents (
                    user_id, team_id, client_id, project_id, invoice_id, transaction_id, project_financial_entry_id,
                    file_name, file_url, provider, document_type, document_visibility, description, mime_type, size, archived, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
            `, [
                req.userId,
                teamId,
                req.body.client_id || null,
                projectId,
                req.body.invoice_id || null,
                req.body.transaction_id || null,
                req.body.project_financial_entry_id || null,
                req.body.file_name.trim(),
                req.body.file_url.trim(),
                req.body.provider || 'external',
                req.body.document_type || 'other',
                documentVisibility,
                req.body.description || null,
                req.body.mime_type || null,
                req.body.size || null
            ]);

            await logActivity(db, req.userId, 'create', 'document', result.lastID, { team_id: teamId });
            return res.status(201).json({ id: result.lastID, message: 'Documento cadastrado.' });
        } catch (error) {
            console.error('[DocumentController.create]', error);
            return res.status(500).json({ error: 'Erro ao criar documento.' });
        }
    },

    async update(req, res) {
        try {
            const validationError = validatePayload(req.body, true);
            if (validationError) return res.status(400).json({ error: validationError });

            const db = await connectDb();
            const document = await getDocumentAccess(db, req.params.id, req.userId);
            if (!document || !document.can_edit) return res.status(403).json({ error: 'Sem permissão para editar documento.' });

            const nextDocument = {
                ...document,
                team_id: Object.prototype.hasOwnProperty.call(req.body, 'team_id') ? req.body.team_id : document.team_id,
                client_id: Object.prototype.hasOwnProperty.call(req.body, 'client_id') ? req.body.client_id : document.client_id,
                project_id: Object.prototype.hasOwnProperty.call(req.body, 'project_id') ? req.body.project_id : document.project_id,
                invoice_id: Object.prototype.hasOwnProperty.call(req.body, 'invoice_id') ? req.body.invoice_id : document.invoice_id,
                transaction_id: Object.prototype.hasOwnProperty.call(req.body, 'transaction_id') ? req.body.transaction_id : document.transaction_id,
                project_financial_entry_id: Object.prototype.hasOwnProperty.call(req.body, 'project_financial_entry_id')
                    ? req.body.project_financial_entry_id
                    : document.project_financial_entry_id
            };
            const nextAccess = await resolveAccess(db, req.userId, nextDocument);
            if (!nextAccess.can_view || !nextAccess.can_edit) {
                return res.status(403).json({ error: 'Sem permissão para mover documento para este contexto.' });
            }

            const nextTeamId = Object.prototype.hasOwnProperty.call(req.body, 'team_id')
                ? (req.body.team_id || nextAccess.inferred_team_id || null)
                : (nextAccess.inferred_team_id || document.team_id || null);

            await db.run(`
                UPDATE documents
                SET file_name = COALESCE(?, file_name),
                    file_url = COALESCE(?, file_url),
                    provider = COALESCE(?, provider),
                    document_type = COALESCE(?, document_type),
                    document_visibility = COALESCE(?, document_visibility),
                    description = COALESCE(?, description),
                    team_id = ?,
                    client_id = ?,
                    project_id = ?,
                    invoice_id = ?,
                    transaction_id = ?,
                    project_financial_entry_id = ?,
                    mime_type = COALESCE(?, mime_type),
                    size = COALESCE(?, size),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                req.body.file_name === undefined ? null : req.body.file_name.trim(),
                req.body.file_url === undefined ? null : req.body.file_url.trim(),
                req.body.provider,
                req.body.document_type,
                req.body.document_visibility,
                req.body.description,
                nextTeamId,
                nextDocument.client_id || null,
                nextDocument.project_id || null,
                nextDocument.invoice_id || null,
                nextDocument.transaction_id || null,
                nextDocument.project_financial_entry_id || null,
                req.body.mime_type,
                req.body.size,
                req.params.id
            ]);

            await logActivity(db, req.userId, 'update', 'document', req.params.id);
            return res.json({ message: 'Documento atualizado.' });
        } catch (error) {
            console.error('[DocumentController.update]', error);
            return res.status(500).json({ error: 'Erro ao atualizar documento.' });
        }
    },

    async archive(req, res) {
        try {
            const db = await connectDb();
            const document = await getDocumentAccess(db, req.params.id, req.userId);
            if (!document || !document.can_edit) return res.status(403).json({ error: 'Sem permissão para arquivar documento.' });

            await db.run('UPDATE documents SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
            await logActivity(db, req.userId, 'archive', 'document', req.params.id);
            return res.json({ message: 'Documento arquivado.' });
        } catch (error) {
            console.error('[DocumentController.archive]', error);
            return res.status(500).json({ error: 'Erro ao arquivar documento.' });
        }
    },

    async restore(req, res) {
        try {
            const db = await connectDb();
            const document = await getDocumentAccess(db, req.params.id, req.userId);
            if (!document || !document.can_edit) return res.status(403).json({ error: 'Sem permissão para restaurar documento.' });

            await db.run('UPDATE documents SET archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
            await logActivity(db, req.userId, 'restore', 'document', req.params.id);
            return res.json({ message: 'Documento restaurado.' });
        } catch (error) {
            console.error('[DocumentController.restore]', error);
            return res.status(500).json({ error: 'Erro ao restaurar documento.' });
        }
    },

    async destroy(req, res) {
        return module.exports.archive(req, res);
    },

    async share(req, res) {
        try {
            const db = await connectDb();
            const document = await getDocumentAccess(db, req.params.id, req.userId);
            if (!document || !await canShareDocument(db, req.userId, document)) {
                return res.status(403).json({ error: 'Sem permissão para compartilhar documento.' });
            }

            const userId = Number(req.body.user_id);
            const permission = ['view', 'edit', 'manage'].includes(req.body.permission)
                ? req.body.permission
                : 'view';

            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(400).json({ error: 'Usuário inválido para compartilhamento.' });
            }

            const target = await db.get('SELECT id FROM users WHERE id = ?', [userId]);
            if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

            await db.run(`
                INSERT INTO document_permissions (document_id, user_id, permission, role, granted_by)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(document_id, user_id, team_id) DO UPDATE SET
                    permission = excluded.permission,
                    role = excluded.role,
                    granted_by = excluded.granted_by
            `, [req.params.id, userId, permission, permission, req.userId]);

            await logActivity(db, req.userId, 'share', 'document', req.params.id, { user_id: userId, permission });
            return res.status(201).json({ message: 'Documento compartilhado.' });
        } catch (error) {
            console.error('[DocumentController.share]', error);
            return res.status(500).json({ error: 'Erro ao compartilhar documento.' });
        }
    },

    async byProject(req, res) {
        try {
            const db = await connectDb();
            const projectId = req.params.id;
            const project = await getProjectAccess(db, req.userId, projectId);
            if (!project) {
                return res.json([]);
            }

            const status = normalizeStatus(req.query.status);
            const search = normalizeSearch(req.query.search || req.query.q);
            const params = [projectId, projectId, status, status, status];
            let query = `
                SELECT d.*, t.name as team_name, c.name as client_name, p.title as project_title, i.number as invoice_number,
                       CASE
                           WHEN d.team_id IS NULL AND d.user_id = ? THEN 1
                           WHEN tm.role IN ('owner', 'admin', 'gestor') THEN 1
                           WHEN COALESCE(dp.permission, dp.role) IN ('edit', 'manage') THEN 1
                           ELSE 0
                       END as can_edit
                FROM documents d
                LEFT JOIN teams t ON t.id = d.team_id
                LEFT JOIN clients c ON c.id = d.client_id
                LEFT JOIN projects p ON p.id = d.project_id
                LEFT JOIN invoices i ON i.id = d.invoice_id
                LEFT JOIN team_members tm ON tm.team_id = d.team_id AND tm.user_id = ? AND tm.status = 'active'
                LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = ?
                WHERE (
                    d.project_id = ?
                    OR (d.project_id IS NULL AND i.project_id = ?)
                )
                AND (
                    (? = 'active' AND d.archived = 0)
                    OR (? = 'archived' AND d.archived = 1)
                    OR ? = 'all'
                )
            `;
            params.unshift(req.userId, req.userId, req.userId);

            if (req.query.document_type) {
                query += ' AND d.document_type = ?';
                params.push(req.query.document_type);
            }

            if (req.query.provider) {
                query += ' AND d.provider = ?';
                params.push(req.query.provider);
            }

            if (search) {
                query += `
                    AND (
                        LOWER(d.file_name) LIKE LOWER(?)
                        OR LOWER(COALESCE(d.description, '')) LIKE LOWER(?)
                        OR LOWER(COALESCE(d.file_url, '')) LIKE LOWER(?)
                        OR LOWER(COALESCE(i.number, '')) LIKE LOWER(?)
                    )
                `;
                const searchParam = `%${search}%`;
                params.push(searchParam, searchParam, searchParam, searchParam);
            }

            query += ' ORDER BY d.created_at DESC, d.id DESC';

            const documents = await db.all(query, params);
            const visibleDocuments = [];
            for (const document of documents) {
                if (await canViewDocument(db, req.userId, document)) {
                    visibleDocuments.push(sanitizeDocumentForRole({
                        ...document,
                        can_edit: await canEditDocument(db, req.userId, document)
                    }));
                }
            }

            return res.json(visibleDocuments);
        } catch (error) {
            console.error('[DocumentController.byProject]', error);
            return res.status(500).json({ error: 'Erro ao listar documentos do projeto.' });
        }
    },

    async byClient(req, res) {
        req.query.client_id = req.params.id;
        return module.exports.index(req, res);
    },

    async byInvoice(req, res) {
        req.query.invoice_id = req.params.id;
        return module.exports.index(req, res);
    }
};
