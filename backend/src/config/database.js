const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

async function connectDb() {
    const db = await open({
        filename: path.resolve(__dirname, 'database.sqlite'),
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

    return db;
}

module.exports = connectDb;
