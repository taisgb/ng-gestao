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

// --- CLIENTES ---
routes.post('/clients', ClientController.create);
routes.get('/clients', ClientController.index);
routes.get('/clients/:id', ClientController.show);
routes.put('/clients/:id', ClientController.update);
routes.delete('/clients/:id', ClientController.destroy); 

// --- PROJETOS ---
routes.post('/projects', ProjectController.create);
routes.get('/projects', ProjectController.index);
routes.get('/projects/:id', ProjectController.show);
routes.put('/projects/:id', ProjectController.update);
routes.delete('/projects/:id', ProjectController.destroy);
routes.post('/projects/:id/share', ProjectController.share);
routes.get('/projects/:id/members', ProjectController.members);
routes.get('/projects/:id/finance', ProjectController.finance);
routes.put('/projects/:id/finance', ProjectController.updateFinance);
routes.get('/projects/:id/statuses', ProjectController.statuses);
routes.post('/projects/:id/statuses', ProjectController.createStatus);
routes.get('/projects/:id/notes', ProjectController.notes);
routes.post('/projects/:id/notes', ProjectController.createNote);

// --- TAREFAS E SERVIÇOS DO DIA ---
routes.post('/tasks', TaskController.create);
routes.get('/tasks', TaskController.index);
routes.get('/tasks/today', TaskController.today);
routes.get('/tasks/project/:project_id', TaskController.filterByProject);
routes.put('/tasks/:id', TaskController.update);
routes.delete('/tasks/:id', TaskController.destroy);      

// --- FINANCEIRO PESSOAL E DÍVIDAS ---
routes.get('/personal/dashboard', PersonalController.getDashboard);
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
routes.put('/invoices/:id', InvoiceController.update);
routes.delete('/invoices/:id', InvoiceController.destroy);

// --- SERVICOS PERSONALIZADOS ---
routes.post('/services', ServiceController.create);
routes.get('/services', ServiceController.index);
routes.put('/services/:id', ServiceController.update);
routes.delete('/services/:id', ServiceController.destroy);

// --- PAGAMENTOS / STRIPE ---
routes.post('/checkout', CheckoutController.create); 

module.exports = routes;
