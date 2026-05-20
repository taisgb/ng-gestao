const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const namedConnections = new Map();
let postgresConnection = null;

const POSTGRES_SCHEMA = `
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        plan TEXT DEFAULT 'free',
        role TEXT DEFAULT 'member',
        is_super_admin INTEGER DEFAULT 0,
        role_title TEXT,
        location TEXT,
        bio TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invitations (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        plan TEXT DEFAULT 'convidado',
        invited_by INTEGER NOT NULL REFERENCES users(id),
        accepted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        owner_id INTEGER NOT NULL REFERENCES users(id),
        archived INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id),
        user_id INTEGER REFERENCES users(id),
        email TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(team_id, email)
    );

    CREATE TABLE IF NOT EXISTS team_invites (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id),
        email TEXT NOT NULL,
        invited_by INTEGER NOT NULL REFERENCES users(id),
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accepted_at TIMESTAMP,
        UNIQUE(team_id, email)
    );

    CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        team_id INTEGER REFERENCES teams(id),
        scope TEXT DEFAULT 'individual',
        name TEXT NOT NULL,
        contact_name TEXT,
        phone TEXT,
        email TEXT,
        document TEXT,
        archived INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        client_id INTEGER NOT NULL REFERENCES clients(id),
        team_id INTEGER REFERENCES teams(id),
        scope TEXT DEFAULT 'individual',
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pendente',
        base_value DOUBLE PRECISION DEFAULT 0,
        payment_type TEXT,
        payment_status TEXT DEFAULT 'pendente',
        amount_paid DOUBLE PRECISION DEFAULT 0,
        deadline DATE,
        archived INTEGER DEFAULT 0,
        archived_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_members (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        role TEXT DEFAULT 'collaborator',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS project_statuses (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, name)
    );

    CREATE TABLE IF NOT EXISTS project_notes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        note TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_financial_shares (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount DOUBLE PRECISION DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_by INTEGER REFERENCES users(id),
        assigned_to INTEGER REFERENCES users(id),
        project_id INTEGER REFERENCES projects(id),
        client_id INTEGER REFERENCES clients(id),
        team_id INTEGER REFERENCES teams(id),
        service_id INTEGER,
        invoice_id INTEGER,
        document_id INTEGER,
        financial_entry_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        task_type TEXT DEFAULT 'operational',
        priority TEXT DEFAULT 'medium',
        scope TEXT DEFAULT 'individual',
        status TEXT DEFAULT 'pendente',
        due_date DATE,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        team_id INTEGER REFERENCES teams(id),
        scope TEXT DEFAULT 'individual',
        name TEXT NOT NULL,
        default_price DOUBLE PRECISION DEFAULT 0,
        default_value DOUBLE PRECISION DEFAULT 0,
        description TEXT,
        active INTEGER DEFAULT 1,
        archived INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        project_id INTEGER REFERENCES projects(id),
        number TEXT,
        client_name TEXT NOT NULL,
        description TEXT,
        amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        issue_date DATE NOT NULL,
        status TEXT DEFAULT 'pendente',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        entity TEXT NOT NULL DEFAULT 'MEI',
        category TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        date DATE NOT NULL,
        description TEXT,
        project_id INTEGER REFERENCES projects(id),
        project_financial_entry_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS personal_status (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        total_bank_balance DOUBLE PRECISION DEFAULT 0,
        total_debt DOUBLE PRECISION DEFAULT 0,
        credit_card_bill DOUBLE PRECISION DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS renegotiations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        description TEXT NOT NULL,
        installment_value DOUBLE PRECISION NOT NULL,
        total_installments INTEGER,
        current_installment INTEGER DEFAULT 1,
        start_date DATE NOT NULL,
        active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS project_financial_entries (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        team_id INTEGER REFERENCES teams(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_by INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        date DATE NOT NULL,
        status TEXT DEFAULT 'pending',
        payment_method TEXT,
        affects_project_total INTEGER DEFAULT 0,
        affects_my_financial INTEGER DEFAULT 0,
        reimbursable INTEGER DEFAULT 0,
        reimbursed_at DATE,
        notes TEXT,
        archived INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_fiscal_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        company_type TEXT DEFAULT 'mei',
        annual_revenue_limit DOUBLE PRECISION DEFAULT 81000,
        opening_date DATE,
        use_proportional_limit INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS personal_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        date DATE NOT NULL,
        status TEXT DEFAULT 'expected',
        payment_method TEXT,
        source TEXT DEFAULT 'manual',
        project_id INTEGER REFERENCES projects(id),
        team_id INTEGER REFERENCES teams(id),
        transaction_id INTEGER REFERENCES transactions(id),
        project_financial_entry_id INTEGER REFERENCES project_financial_entries(id),
        notes TEXT,
        is_recurring INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        team_id INTEGER REFERENCES teams(id),
        client_id INTEGER REFERENCES clients(id),
        project_id INTEGER REFERENCES projects(id),
        invoice_id INTEGER REFERENCES invoices(id),
        transaction_id INTEGER REFERENCES transactions(id),
        project_financial_entry_id INTEGER REFERENCES project_financial_entries(id),
        file_name TEXT NOT NULL,
        file_url TEXT NOT NULL,
        provider TEXT DEFAULT 'external',
        document_type TEXT DEFAULT 'other',
        description TEXT,
        mime_type TEXT,
        size INTEGER,
        archived INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS document_permissions (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id),
        user_id INTEGER REFERENCES users(id),
        team_id INTEGER REFERENCES teams(id),
        role TEXT DEFAULT 'viewer',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(document_id, user_id, team_id)
    );
`;

function translateSqlForPostgres(sql) {
    let translated = sql
        .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
        .replace(/strftime\('%Y-%m',\s*([^)]+)\)/gi, "TO_CHAR($1::date, 'YYYY-MM')")
        .replace(/strftime\('%m',\s*([^)]+)\)/gi, "TO_CHAR($1::date, 'MM')")
        .replace(/strftime\('%Y',\s*([^)]+)\)/gi, "TO_CHAR($1::date, 'YYYY')")
        .replace(/DATE\('now'\)/gi, 'CURRENT_DATE');

    let index = 0;
    translated = translated.replace(/\?/g, () => `$${++index}`);

    const returningColumn = /\bINTO\s+personal_status\b/i.test(translated) ? 'user_id' : 'id';

    if (/^\s*INSERT\s+/i.test(translated) && !/\bRETURNING\b/i.test(translated)) {
        const trimmed = translated.trim().replace(/;$/, '');
        translated = `${trimmed} RETURNING ${returningColumn}`;
    }

    if (/INSERT\s+INTO/i.test(translated) && /project_statuses|project_financial_shares|project_members|personal_status/i.test(translated) && !/\bON\s+CONFLICT\b/i.test(translated)) {
        translated = translated.replace(new RegExp(`\\s+RETURNING ${returningColumn}$`, 'i'), ` ON CONFLICT DO NOTHING RETURNING ${returningColumn}`);
    }

    return translated;
}

class PostgresCompatDb {
    constructor(pool) {
        this.pool = pool;
        this.isPostgres = true;
    }

    async get(sql, params = []) {
        const result = await this.pool.query(translateSqlForPostgres(sql), params);
        return result.rows[0];
    }

    async all(sql, params = []) {
        const result = await this.pool.query(translateSqlForPostgres(sql), params);
        return result.rows;
    }

    async run(sql, params = []) {
        const result = await this.pool.query(translateSqlForPostgres(sql), params);
        return {
            lastID: result.rows?.[0]?.id ?? result.rows?.[0]?.user_id,
            changes: result.rowCount
        };
    }

    async exec(sql) {
        return this.pool.query(sql);
    }

    async close() {
        await this.pool.end();
        postgresConnection = null;
    }
}

async function ensurePostgresColumn(db, table, name, type) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${type}`);
}

async function bootstrapSuperAdmin(db) {
    const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.SUPER_ADMIN_PASSWORD;
    const firstName = (process.env.SUPER_ADMIN_NAME || 'Super').trim();
    const lastName = (process.env.SUPER_ADMIN_LAST_NAME || 'Admin').trim();
    const fullName = `${firstName} ${lastName}`.trim();

    if (!email || !password) return;

    const passwordHash = await bcrypt.hash(password, 10);
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
        await db.run(
            "UPDATE users SET name = ?, password = ?, plan = 'admin', role = 'owner', is_super_admin = 1 WHERE id = ?",
            [fullName, passwordHash, existing.id]
        );
        return;
    }

    await db.run(
        "INSERT INTO users (name, email, password, plan, role, is_super_admin) VALUES (?, ?, ?, 'admin', 'owner', 1)",
        [fullName, email, passwordHash]
    );
}

async function connectPostgresDb() {
    if (postgresConnection) return postgresConnection;

    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL é obrigatório para conectar ao PostgreSQL.');
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'true'
            ? { rejectUnauthorized: false }
            : false
    });

    const db = new PostgresCompatDb(pool);
    await db.exec(POSTGRES_SCHEMA);

    await ensurePostgresColumn(db, 'users', 'role', "TEXT DEFAULT 'member'");
    await ensurePostgresColumn(db, 'users', 'is_super_admin', 'INTEGER DEFAULT 0');
    await ensurePostgresColumn(db, 'users', 'role_title', 'TEXT');
    await ensurePostgresColumn(db, 'users', 'location', 'TEXT');
    await ensurePostgresColumn(db, 'users', 'bio', 'TEXT');
    await ensurePostgresColumn(db, 'clients', 'team_id', 'INTEGER REFERENCES teams(id)');
    await ensurePostgresColumn(db, 'clients', 'scope', "TEXT DEFAULT 'individual'");
    await ensurePostgresColumn(db, 'projects', 'team_id', 'INTEGER REFERENCES teams(id)');
    await ensurePostgresColumn(db, 'projects', 'scope', "TEXT DEFAULT 'individual'");
    await ensurePostgresColumn(db, 'projects', 'archived_at', 'TIMESTAMP');
    await ensurePostgresColumn(db, 'project_members', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await ensurePostgresColumn(db, 'services', 'team_id', 'INTEGER REFERENCES teams(id)');
    await ensurePostgresColumn(db, 'services', 'scope', "TEXT DEFAULT 'individual'");
    await ensurePostgresColumn(db, 'services', 'default_value', 'DOUBLE PRECISION DEFAULT 0');
    await ensurePostgresColumn(db, 'services', 'archived', 'INTEGER DEFAULT 0');
    await ensurePostgresColumn(db, 'tasks', 'team_id', 'INTEGER REFERENCES teams(id)');
    await ensurePostgresColumn(db, 'tasks', 'created_by', 'INTEGER REFERENCES users(id)');
    await ensurePostgresColumn(db, 'tasks', 'assigned_to', 'INTEGER REFERENCES users(id)');
    await ensurePostgresColumn(db, 'tasks', 'client_id', 'INTEGER REFERENCES clients(id)');
    await ensurePostgresColumn(db, 'tasks', 'service_id', 'INTEGER REFERENCES services(id)');
    await ensurePostgresColumn(db, 'tasks', 'invoice_id', 'INTEGER REFERENCES invoices(id)');
    await ensurePostgresColumn(db, 'tasks', 'document_id', 'INTEGER REFERENCES documents(id)');
    await ensurePostgresColumn(db, 'tasks', 'financial_entry_id', 'INTEGER REFERENCES project_financial_entries(id)');
    await ensurePostgresColumn(db, 'tasks', 'description', 'TEXT');
    await ensurePostgresColumn(db, 'tasks', 'priority', "TEXT DEFAULT 'medium'");
    await ensurePostgresColumn(db, 'tasks', 'scope', "TEXT DEFAULT 'individual'");
    await ensurePostgresColumn(db, 'tasks', 'completed_at', 'TIMESTAMP');
    await ensurePostgresColumn(db, 'tasks', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await ensurePostgresColumn(db, 'tasks', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await db.exec('ALTER TABLE tasks ALTER COLUMN due_date DROP NOT NULL');
    await ensurePostgresColumn(db, 'transactions', 'project_financial_entry_id', 'INTEGER');
    await ensurePostgresColumn(db, 'personal_transactions', 'team_id', 'INTEGER REFERENCES teams(id)');
    await ensurePostgresColumn(db, 'personal_transactions', 'transaction_id', 'INTEGER REFERENCES transactions(id)');
    await ensurePostgresColumn(db, 'personal_transactions', 'project_financial_entry_id', 'INTEGER REFERENCES project_financial_entries(id)');
    await ensurePostgresColumn(db, 'personal_transactions', 'is_recurring', 'INTEGER DEFAULT 0');
    await ensurePostgresColumn(db, 'personal_transactions', 'archived', 'INTEGER DEFAULT 0');
    await ensurePostgresColumn(db, 'documents', 'team_id', 'INTEGER REFERENCES teams(id)');
    await ensurePostgresColumn(db, 'documents', 'client_id', 'INTEGER REFERENCES clients(id)');
    await ensurePostgresColumn(db, 'documents', 'project_id', 'INTEGER REFERENCES projects(id)');
    await ensurePostgresColumn(db, 'documents', 'invoice_id', 'INTEGER REFERENCES invoices(id)');
    await ensurePostgresColumn(db, 'documents', 'transaction_id', 'INTEGER REFERENCES transactions(id)');
    await ensurePostgresColumn(db, 'documents', 'project_financial_entry_id', 'INTEGER REFERENCES project_financial_entries(id)');

    await bootstrapSuperAdmin(db);

    console.log('Conectado ao banco de dados PostgreSQL.');
    postgresConnection = db;
    return db;
}

async function connectDb() {
    if (process.env.DATABASE_URL && !process.env.SQLITE_FILENAME) {
        return connectPostgresDb();
    }

    if (process.env.NODE_ENV === 'production' && !process.env.SQLITE_FILENAME) {
        throw new Error('DATABASE_URL e obrigatorio em producao. SQLite fica apenas para uso local/backup.');
    }

    const filename = process.env.SQLITE_FILENAME
        ? path.resolve(process.env.SQLITE_FILENAME)
        : path.resolve(__dirname, 'database.sqlite');

    if (process.env.SQLITE_FILENAME && namedConnections.has(filename)) {
        const cachedDb = namedConnections.get(filename);
        await bootstrapSuperAdmin(cachedDb);
        return cachedDb;
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
            team_id INTEGER,
            scope TEXT DEFAULT 'individual',
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
            created_by INTEGER,
            assigned_to INTEGER,
            project_id INTEGER,
            client_id INTEGER,
            team_id INTEGER,
            service_id INTEGER,
            invoice_id INTEGER,
            document_id INTEGER,
            financial_entry_id INTEGER,
            title TEXT NOT NULL,
            description TEXT,
            task_type TEXT DEFAULT 'operational',
            priority TEXT DEFAULT 'medium',
            scope TEXT DEFAULT 'individual',
            status TEXT DEFAULT 'pendente',
            due_date DATE,
            completed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
    await ensureColumn('projects', 'scope', "TEXT DEFAULT 'individual'");
    await ensureColumn('projects', 'archived_at', 'DATETIME');
    await ensureColumn('project_members', 'updated_at', 'DATETIME');
    await ensureColumn('services', 'team_id', 'INTEGER');
    await ensureColumn('services', 'scope', "TEXT DEFAULT 'individual'");
    await ensureColumn('services', 'default_value', 'REAL DEFAULT 0');
    await ensureColumn('services', 'archived', 'INTEGER DEFAULT 0');
    await ensureColumn('services', 'updated_at', 'DATETIME');
    await ensureColumn('tasks', 'team_id', 'INTEGER');
    await ensureColumn('tasks', 'created_by', 'INTEGER');
    await ensureColumn('tasks', 'assigned_to', 'INTEGER');
    await ensureColumn('tasks', 'client_id', 'INTEGER');
    await ensureColumn('tasks', 'service_id', 'INTEGER');
    await ensureColumn('tasks', 'invoice_id', 'INTEGER');
    await ensureColumn('tasks', 'document_id', 'INTEGER');
    await ensureColumn('tasks', 'financial_entry_id', 'INTEGER');
    await ensureColumn('tasks', 'description', 'TEXT');
    await ensureColumn('tasks', 'priority', "TEXT DEFAULT 'medium'");
    await ensureColumn('tasks', 'scope', "TEXT DEFAULT 'individual'");
    await ensureColumn('tasks', 'completed_at', 'DATETIME');
    await ensureColumn('tasks', 'created_at', 'DATETIME');
    await ensureColumn('tasks', 'updated_at', 'DATETIME');
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
    await ensureColumn('users', 'role', "TEXT DEFAULT 'member'");
    await ensureColumn('users', 'is_super_admin', 'INTEGER DEFAULT 0');

    await db.exec(`
        CREATE TABLE IF NOT EXISTS document_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            user_id INTEGER,
            team_id INTEGER,
            role TEXT DEFAULT 'viewer',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(document_id, user_id, team_id),
            FOREIGN KEY (document_id) REFERENCES documents(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (team_id) REFERENCES teams(id)
        );
    `);

    await bootstrapSuperAdmin(db);

    if (process.env.SQLITE_FILENAME) {
        namedConnections.set(filename, db);
    }

    return db;
}

module.exports = connectDb;
