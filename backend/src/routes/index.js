// src/routes/index.js
const express = require('express');
const routes = express.Router();

// Importação dos Controllers
const ClientController = require('../controllers/ClientController');
const ProjectController = require('../controllers/ProjectController');
const TaskController = require('../controllers/TaskController');
const PersonalController = require('../controllers/PersonalController');
const TransactionController = require('../controllers/TransactionController');
const UserController = require('../controllers/UserController');       
const SessionController = require('../controllers/SessionController'); 
const CheckoutController = require('../controllers/CheckoutController'); 
const ServiceController = require('../controllers/ServiceController');
const InvoiceController = require('../controllers/InvoiceController');
const TeamController = require('../controllers/TeamController');
const ProjectFinancialController = require('../controllers/ProjectFinancialController');
const PersonalTransactionController = require('../controllers/PersonalTransactionController');
const DocumentController = require('../controllers/DocumentController');
// Importação do Middleware de Autenticação
const authMiddleware = require('../middlewares/auth'); 
const rateLimit = require('../middlewares/rateLimit');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Muitas tentativas de acesso. Aguarde alguns minutos.' });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 80 });

// --- ROTAS PÚBLICAS (Acessíveis sem login) ---
routes.get('/', (req, res) => {
    return res.json({ message: 'API do Sistema de Gestão rodando perfeitamente!' });
});

routes.post('/users', authLimiter, UserController.store);      // Cadastro de conta
routes.post('/sessions', authLimiter, SessionController.store); // Login (Gera o Token)

// --- MIDDLEWARE DE SEGURANÇA ---
// A partir daqui, todas as rotas exigem o Token JWT no cabeçalho (Header)
routes.use(authMiddleware);
routes.use(writeLimiter);

// --- PERFIL E ADMINISTRAÇÃO ---
routes.get('/profile', UserController.show);             // Ver seus dados e plano
routes.put('/profile', UserController.update);
routes.put('/admin/promote', UserController.promote);    // Mudar plano (Só Admin)
routes.get('/admin/users', UserController.listUsers);
routes.post('/admin/invitations', UserController.createInvitation);
routes.get('/admin/invitations', UserController.listInvitations);

// --- TIMES / EQUIPES ---
routes.get('/teams', TeamController.index);
routes.post('/teams', TeamController.create);
routes.get('/teams/:id', TeamController.show);
routes.put('/teams/:id', TeamController.update);
routes.patch('/teams/:id/archive', TeamController.archive);
routes.patch('/teams/:id/restore', TeamController.restore);
routes.delete('/teams/:id', TeamController.destroy);
routes.get('/teams/:id/members', TeamController.members);
routes.post('/teams/:id/members', TeamController.addMember);
routes.put('/teams/:id/members/:memberId', TeamController.updateMember);
routes.delete('/teams/:id/members/:memberId', TeamController.removeMember);

// --- CLIENTES ---
routes.post('/clients', ClientController.create);
routes.get('/clients', ClientController.index);
routes.get('/clients/:id/projects', ClientController.projects);
routes.get('/clients/:id/documents', DocumentController.byClient);
routes.patch('/clients/:id/archive', ClientController.archive);
routes.patch('/clients/:id/restore', ClientController.restore);
routes.get('/clients/:id', ClientController.show);
routes.put('/clients/:id', ClientController.update);
routes.delete('/clients/:id', ClientController.destroy); 

// --- PROJETOS ---
routes.post('/projects', ProjectController.create);
routes.get('/projects', ProjectController.index);
routes.get('/projects/warranty-alerts', ProjectController.warrantyAlerts);
routes.patch('/projects/:id/archive', ProjectController.archive);
routes.patch('/projects/:id/restore', ProjectController.restore);
routes.get('/projects/:id/documents', DocumentController.byProject);
routes.get('/projects/:id', ProjectController.show);
routes.put('/projects/:id', ProjectController.update);
routes.delete('/projects/:id', ProjectController.destroy);
routes.post('/projects/:id/share', ProjectController.share);
routes.patch('/projects/:id/owner', ProjectController.transferOwner);
routes.get('/projects/:id/members', ProjectController.members);
routes.get('/projects/:projectId/members/:userId/permissions', ProjectController.memberPermissions);
routes.put('/projects/:projectId/members/:userId/permissions', ProjectController.updateMemberPermissions);
routes.delete('/projects/:projectId/members/:memberId', ProjectController.removeMember);
routes.get('/projects/:id/finance', ProjectController.finance);
routes.put('/projects/:id/finance', ProjectController.updateFinance);
routes.get('/projects/:id/finance-summary', ProjectFinancialController.summary);
routes.get('/projects/:id/financial-entries', ProjectFinancialController.index);
routes.post('/projects/:id/financial-entries', ProjectFinancialController.create);
routes.put('/projects/:id/financial-entries/:entryId', ProjectFinancialController.update);
routes.patch('/projects/:id/financial-entries/:entryId/status', ProjectFinancialController.updateStatus);
routes.patch('/projects/:id/financial-entries/:entryId/restore', ProjectFinancialController.restore);
routes.delete('/projects/:id/financial-entries/:entryId', ProjectFinancialController.destroy);
routes.get('/projects/:id/statuses', ProjectController.statuses);
routes.post('/projects/:id/statuses', ProjectController.createStatus);
routes.get('/projects/:id/notes', ProjectController.notes);
routes.post('/projects/:id/notes', ProjectController.createNote);

// --- TAREFAS E SERVIÇOS DO DIA ---
routes.post('/tasks', TaskController.create);
routes.get('/tasks', TaskController.index);
routes.get('/tasks/summary', TaskController.summary);
routes.get('/tasks/today', TaskController.today);
routes.get('/tasks/week', TaskController.week);
routes.get('/tasks/project/:project_id', TaskController.filterByProject);
routes.put('/tasks/:id', TaskController.update);
routes.patch('/tasks/:id/status', TaskController.updateStatus);
routes.delete('/tasks/:id', TaskController.destroy);      

// --- FINANCEIRO PESSOAL E DÍVIDAS ---
routes.get('/personal/dashboard', PersonalController.getDashboard);
routes.get('/personal/summary', PersonalTransactionController.summary);
routes.get('/personal/transactions', PersonalTransactionController.index);
routes.post('/personal/transactions', PersonalTransactionController.create);
routes.put('/personal/transactions/:id', PersonalTransactionController.update);
routes.patch('/personal/transactions/:id/status', PersonalTransactionController.updateStatus);
routes.delete('/personal/transactions/:id', PersonalTransactionController.destroy);
routes.put('/personal/status', PersonalController.updateStatus);
routes.post('/personal/renegotiations', PersonalController.createRenegotiation);
routes.get('/personal/renegotiations', PersonalController.listRenegotiations);

// --- FLUXO DE CAIXA (TRANSAÇÕES) ---
routes.post('/transactions', TransactionController.create);
routes.get('/transactions', TransactionController.index);
routes.delete('/transactions/:id', TransactionController.destroy);

// --- NOTAS FISCAIS ---
routes.post('/invoices', InvoiceController.create);
routes.get('/invoices', InvoiceController.index);
routes.get('/invoices/fiscal-settings', InvoiceController.fiscalSettings);
routes.put('/invoices/fiscal-settings', InvoiceController.updateFiscalSettings);
routes.get('/invoices/summary', InvoiceController.summary);
routes.get('/invoices/:id/documents', DocumentController.byInvoice);
routes.put('/invoices/:id', InvoiceController.update);
routes.delete('/invoices/:id', InvoiceController.destroy);

// --- DOCUMENTOS ---
routes.get('/documents', DocumentController.index);
routes.post('/documents', DocumentController.create);
routes.put('/documents/:id', DocumentController.update);
routes.post('/documents/:id/share', DocumentController.share);
routes.patch('/documents/:id/archive', DocumentController.archive);
routes.patch('/documents/:id/restore', DocumentController.restore);
routes.delete('/documents/:id', DocumentController.destroy);

// --- SERVICOS PERSONALIZADOS ---
routes.post('/services', ServiceController.create);
routes.get('/services', ServiceController.index);
routes.put('/services/:id', ServiceController.update);
routes.patch('/services/:id/archive', ServiceController.archive);
routes.patch('/services/:id/restore', ServiceController.restore);
routes.delete('/services/:id', ServiceController.destroy);

// --- PAGAMENTOS / STRIPE ---
routes.post('/checkout', CheckoutController.create); 

module.exports = routes;
