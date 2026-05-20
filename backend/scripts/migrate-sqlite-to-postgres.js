require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const connectDb = require('../src/config/database');

const sqlitePath = path.resolve(__dirname, '..', 'src', 'config', 'database.sqlite');

const tables = [
    { name: 'users', conflict: 'id', sequence: true },
    { name: 'invitations', conflict: 'id', sequence: true },
    { name: 'teams', conflict: 'id', sequence: true },
    { name: 'team_members', conflict: 'id', sequence: true },
    { name: 'team_invites', conflict: 'id', sequence: true },
    { name: 'clients', conflict: 'id', sequence: true },
    { name: 'projects', conflict: 'id', sequence: true },
    { name: 'project_members', conflict: 'id', sequence: true },
    { name: 'project_statuses', conflict: 'id', sequence: true },
    { name: 'project_notes', conflict: 'id', sequence: true },
    { name: 'project_financial_shares', conflict: 'id', sequence: true },
    { name: 'tasks', conflict: 'id', sequence: true },
    { name: 'services', conflict: 'id', sequence: true },
    { name: 'invoices', conflict: 'id', sequence: true },
    { name: 'transactions', conflict: 'id', sequence: true },
    { name: 'project_financial_entries', conflict: 'id', sequence: true },
    { name: 'personal_status', conflict: 'user_id', sequence: false },
    { name: 'renegotiations', conflict: 'id', sequence: true },
    { name: 'personal_transactions', conflict: 'id', sequence: true },
    { name: 'user_fiscal_settings', conflict: 'id', sequence: true },
    { name: 'documents', conflict: 'id', sequence: true },
    { name: 'document_permissions', conflict: 'id', sequence: true }
];

async function tableExists(sqliteDb, table) {
    const row = await sqliteDb.get(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table]
    );
    return Boolean(row);
}

async function getSqliteColumns(sqliteDb, table) {
    const columns = await sqliteDb.all(`PRAGMA table_info(${table})`);
    return columns.map(column => column.name);
}

async function getPostgresColumns(pgDb, table) {
    const columns = await pgDb.all(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?",
        [table]
    );
    return columns.map(column => column.column_name);
}

function quoteIdentifier(identifier) {
    return `"${identifier.replace(/"/g, '""')}"`;
}

async function upsertRows(sqliteDb, pgDb, tableConfig) {
    const { name, conflict } = tableConfig;
    const exists = await tableExists(sqliteDb, name);
    if (!exists) {
        console.log(`- ${name}: tabela nao existe no SQLite, pulando.`);
        return;
    }

    const rows = await sqliteDb.all(`SELECT * FROM ${name}`);
    if (rows.length === 0) {
        console.log(`- ${name}: sem registros.`);
        return;
    }

    const sqliteColumns = await getSqliteColumns(sqliteDb, name);
    const postgresColumns = await getPostgresColumns(pgDb, name);
    const columns = sqliteColumns.filter(column => postgresColumns.includes(column));

    if (!columns.includes(conflict)) {
        console.log(`- ${name}: coluna de conflito ${conflict} ausente, pulando.`);
        return;
    }

    const quotedTable = quoteIdentifier(name);
    const quotedColumns = columns.map(quoteIdentifier).join(', ');
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const updateColumns = columns
        .filter(column => column !== conflict)
        .map(column => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`);

    const conflictClause = updateColumns.length > 0
        ? `DO UPDATE SET ${updateColumns.join(', ')}`
        : 'DO NOTHING';

    const sql = `
        INSERT INTO ${quotedTable} (${quotedColumns})
        VALUES (${placeholders})
        ON CONFLICT (${quoteIdentifier(conflict)}) ${conflictClause}
    `;

    for (const row of rows) {
        const values = columns.map(column => row[column]);
        await pgDb.pool.query(sql, values);
    }

    console.log(`- ${name}: ${rows.length} registro(s) migrado(s).`);
}

async function syncSequence(pgDb, table) {
    await pgDb.exec(`
        SELECT setval(
            pg_get_serial_sequence('${table}', 'id'),
            GREATEST(COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(table)}), 0), 1),
            COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(table)}), 0) > 0
        )
    `);
}

async function ensureSuperAdmin(pgDb) {
    const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.SUPER_ADMIN_PASSWORD;

    if (!email || !password) return;

    const passwordHash = await bcrypt.hash(password, 10);
    const existing = await pgDb.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
        await pgDb.run(
            "UPDATE users SET password = ?, plan = 'admin', role = 'owner', is_super_admin = 1 WHERE id = ?",
            [passwordHash, existing.id]
        );
        return;
    }

    await pgDb.run(
        "INSERT INTO users (name, email, password, plan, role, is_super_admin) VALUES (?, ?, ?, 'admin', 'owner', 1)",
        ['Super Admin', email, passwordHash]
    );
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error('Defina DATABASE_URL antes de rodar a migracao.');
    }

    if (!fs.existsSync(sqlitePath)) {
        throw new Error(`SQLite nao encontrado em ${sqlitePath}`);
    }

    const sqliteDb = await open({ filename: sqlitePath, driver: sqlite3.Database });
    const pgDb = await connectDb();

    try {
        for (const table of tables) {
            await upsertRows(sqliteDb, pgDb, table);
        }

        for (const table of tables.filter(item => item.sequence)) {
            await syncSequence(pgDb, table.name);
        }

        await ensureSuperAdmin(pgDb);
        await syncSequence(pgDb, 'users');

        console.log('Migracao SQLite -> PostgreSQL concluida.');
    } finally {
        await sqliteDb.close();
        await pgDb.close();
    }
}

main().catch(error => {
    console.error('Erro na migracao:', error);
    process.exit(1);
});
