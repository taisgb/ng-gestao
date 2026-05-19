const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const namedConnections = new Map();

async function connectDb() {
    const filename = process.env.SQLITE_FILENAME
        ? path.resolve(process.env.SQLITE_FILENAME)
        : path.resolve(__dirname, 'database.sqlite');

    if (process.env.SQLITE_FILENAME && namedConnections.has(filename)) {
        return namedConnections.get(filename);
    }

    const db = await open({
        filename,
        driver: sqlite3.Database
    });

    await db.get('PRAGMA foreign_keys = ON');
    console.log('✅ Conectado ao banco de dados SQLite.');

    await db.exec(`
        -- 1. Usuários
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            plan TEXT DEFAULT 'free',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- 2. Clientes
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            contact_name TEXT,
            phone TEXT,
            email TEXT,
            document TEXT,
            archived INTEGER DEFAULT 0, 
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- 3. Projetos
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            client_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'pendente', 
            base_value REAL DEFAULT 0, 
            payment_type TEXT, 
            payment_status TEXT DEFAULT 'pendente', 
            amount_paid REAL DEFAULT 0, 
            deadline DATE,
            archived INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (client_id) REFERENCES clients(id)
        );

        -- 4. Tarefas
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            project_id INTEGER,
            title TEXT NOT NULL,
            task_type TEXT DEFAULT 'execução',
            status TEXT DEFAULT 'pendente',
            due_date DATE NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        -- 5. Transações
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL, 
            entity TEXT NOT NULL DEFAULT 'MEI', 
            category TEXT NOT NULL,
            amount REAL NOT NULL,
            date DATE NOT NULL,
            description TEXT,
            project_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        -- 6. Status Pessoal (Visão geral de saúde financeira por usuário)
        CREATE TABLE IF NOT EXISTS personal_status (
            user_id INTEGER PRIMARY KEY,
            total_bank_balance REAL DEFAULT 0,
            total_debt REAL DEFAULT 0,
            credit_card_bill REAL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- 7. Renegociações (Parcelamentos fixos mensais por usuário)
        CREATE TABLE IF NOT EXISTS renegotiations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            installment_value REAL NOT NULL,
            total_installments INTEGER,
            current_installment INTEGER DEFAULT 1,
            start_date DATE NOT NULL,
            active BOOLEAN DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- 8. Colaboradores de projetos
        CREATE TABLE IF NOT EXISTS project_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT DEFAULT 'collaborator',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- 9. Status personalizados por projeto
        CREATE TABLE IF NOT EXISTS project_statuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            position INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, name),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        -- 10. Anotacoes de andamento do projeto
        CREATE TABLE IF NOT EXISTS project_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            note TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- 11. Divisao financeira compartilhada do projeto
        CREATE TABLE IF NOT EXISTS project_financial_shares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            amount REAL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- 12. Servicos personalizados por usuario
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            default_price REAL DEFAULT 0,
            description TEXT,
            active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- 13. Convites de acesso ao sistema
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            plan TEXT DEFAULT 'convidado',
            invited_by INTEGER NOT NULL,
            accepted_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (invited_by) REFERENCES users(id)
        );

        -- 14. Notas fiscais emitidas
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            project_id INTEGER,
            number TEXT,
            client_name TEXT NOT NULL,
            description TEXT,
            amount REAL NOT NULL DEFAULT 0,
            issue_date DATE NOT NULL,
            status TEXT DEFAULT 'pendente',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        -- 15. Times / equipes
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            owner_id INTEGER NOT NULL,
            archived INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER NOT NULL,
            user_id INTEGER,
            email TEXT NOT NULL,
            role TEXT DEFAULT 'member',
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(team_id, email),
            FOREIGN KEY (team_id) REFERENCES teams(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS team_invites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            invited_by INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            accepted_at DATETIME,
            UNIQUE(team_id, email),
            FOREIGN KEY (team_id) REFERENCES teams(id),
            FOREIGN KEY (invited_by) REFERENCES users(id)
        );

        -- 16. Lancamentos financeiros do projeto
        CREATE TABLE IF NOT EXISTS project_financial_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            team_id INTEGER,
            user_id INTEGER NOT NULL,
            created_by INTEGER NOT NULL,
            type TEXT NOT NULL,
            description TEXT NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL DEFAULT 0,
            date DATE NOT NULL,
            status TEXT DEFAULT 'pending',
            payment_method TEXT,
            affects_project_total INTEGER DEFAULT 0,
            affects_my_financial INTEGER DEFAULT 0,
            reimbursable INTEGER DEFAULT 0,
            reimbursed_at DATE,
            notes TEXT,
            archived INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (team_id) REFERENCES teams(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        );

        -- 17. Configuracao fiscal do usuario
        CREATE TABLE IF NOT EXISTS user_fiscal_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            company_type TEXT DEFAULT 'mei',
            annual_revenue_limit REAL DEFAULT 81000,
            opening_date DATE,
            use_proportional_limit INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- 18. Lancamentos financeiros pessoais privados
        CREATE TABLE IF NOT EXISTS personal_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            description TEXT NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL DEFAULT 0,
            date DATE NOT NULL,
            status TEXT DEFAULT 'expected',
            payment_method TEXT,
            source TEXT DEFAULT 'manual',
            project_id INTEGER,
            team_id INTEGER,
            transaction_id INTEGER,
            project_financial_entry_id INTEGER,
            notes TEXT,
            is_recurring INTEGER DEFAULT 0,
            archived INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (team_id) REFERENCES teams(id),
            FOREIGN KEY (transaction_id) REFERENCES transactions(id),
            FOREIGN KEY (project_financial_entry_id) REFERENCES project_financial_entries(id)
        );

        -- 19. Documentos por link externo / Drive
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            team_id INTEGER,
            client_id INTEGER,
            project_id INTEGER,
            invoice_id INTEGER,
            transaction_id INTEGER,
            project_financial_entry_id INTEGER,
            file_name TEXT NOT NULL,
            file_url TEXT NOT NULL,
            provider TEXT DEFAULT 'external',
            document_type TEXT DEFAULT 'other',
            description TEXT,
            mime_type TEXT,
            size INTEGER,
            archived INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (team_id) REFERENCES teams(id),
            FOREIGN KEY (client_id) REFERENCES clients(id),
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (invoice_id) REFERENCES invoices(id),
            FOREIGN KEY (transaction_id) REFERENCES transactions(id),
            FOREIGN KEY (project_financial_entry_id) REFERENCES project_financial_entries(id)
        );
    `);

    const userColumns = await db.all('PRAGMA table_info(users)');
    const existingUserColumns = userColumns.map(column => column.name);
    const profileColumns = [
        ['role_title', 'TEXT'],
        ['location', 'TEXT'],
        ['bio', 'TEXT']
    ];

    for (const [name, type] of profileColumns) {
        if (!existingUserColumns.includes(name)) {
            await db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
        }
    }

    async function ensureColumn(table, name, type) {
        const columns = await db.all(`PRAGMA table_info(${table})`);
        if (!columns.some(column => column.name === name)) {
            await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
        }
    }

    await ensureColumn('clients', 'team_id', 'INTEGER');
    await ensureColumn('clients', 'scope', "TEXT DEFAULT 'individual'");
    await ensureColumn('clients', 'archived', 'INTEGER DEFAULT 0');
    await ensureColumn('projects', 'team_id', 'INTEGER');
    await ensureColumn('projects', 'archived_at', 'DATETIME');
    await ensureColumn('services', 'team_id', 'INTEGER');
    await ensureColumn('services', 'scope', "TEXT DEFAULT 'individual'");
    await ensureColumn('services', 'default_value', 'REAL DEFAULT 0');
    await ensureColumn('services', 'archived', 'INTEGER DEFAULT 0');
    await ensureColumn('services', 'updated_at', 'DATETIME');
    await ensureColumn('tasks', 'team_id', 'INTEGER');
    await ensureColumn('transactions', 'project_financial_entry_id', 'INTEGER');
    await ensureColumn('personal_transactions', 'team_id', 'INTEGER');
    await ensureColumn('personal_transactions', 'transaction_id', 'INTEGER');
    await ensureColumn('personal_transactions', 'project_financial_entry_id', 'INTEGER');
    await ensureColumn('personal_transactions', 'is_recurring', 'INTEGER DEFAULT 0');
    await ensureColumn('personal_transactions', 'archived', 'INTEGER DEFAULT 0');
    await ensureColumn('personal_transactions', 'updated_at', 'DATETIME');
    await ensureColumn('documents', 'team_id', 'INTEGER');
    await ensureColumn('documents', 'client_id', 'INTEGER');
    await ensureColumn('documents', 'project_id', 'INTEGER');
    await ensureColumn('documents', 'invoice_id', 'INTEGER');
    await ensureColumn('documents', 'transaction_id', 'INTEGER');
    await ensureColumn('documents', 'project_financial_entry_id', 'INTEGER');
    await ensureColumn('documents', 'mime_type', 'TEXT');
    await ensureColumn('documents', 'size', 'INTEGER');
    await ensureColumn('documents', 'archived', 'INTEGER DEFAULT 0');
    await ensureColumn('documents', 'updated_at', 'DATETIME');

    if (process.env.SQLITE_FILENAME) {
        namedConnections.set(filename, db);
    }

    return db;
}

module.exports = connectDb;
