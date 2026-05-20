# Deploy com PostgreSQL

## Objetivo

Em producao, o backend deve usar PostgreSQL via `DATABASE_URL`.
SQLite fica apenas para backup/local. Se `NODE_ENV=production` estiver ativo e `DATABASE_URL` nao existir, o backend bloqueia a inicializacao.

## 1. Criar banco PostgreSQL

Use Render, Neon, Supabase, Railway ou outro provedor PostgreSQL.
Copie a connection string do banco no formato:

```env
DATABASE_URL=postgresql://usuario:senha@host:porta/database
```

## 2. Configurar variaveis no Render

No servico backend, configure:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
APP_SECRET=uma_chave_forte
JWT_SECRET=uma_chave_forte
FRONTEND_URL=https://seu-frontend.com
CORS_ORIGINS=https://seu-frontend.com
SUPER_ADMIN_EMAIL=seu-email-admin@dominio.com
SUPER_ADMIN_PASSWORD=uma_senha_forte
DATABASE_SSL=true
```

## 3. Preservar backup SQLite

Antes da migracao, foi criada uma copia em:

```text
backend/backups/database-before-postgres.sqlite
```

Nao versionar `backend/backups/`.

## 4. Rodar migracao

Com `DATABASE_URL` configurada no ambiente:

```bash
cd backend
npm run migrate:postgres
```

O script:

- cria as tabelas no PostgreSQL se nao existirem;
- copia os dados do SQLite local;
- preserva ids quando possivel;
- usa upsert para evitar duplicidade ao rodar novamente;
- atualiza as sequencias do PostgreSQL no final.

## 5. Fazer deploy

Depois da migracao:

```bash
npm start
```

Valide no sistema:

- login/cadastro;
- times;
- clientes;
- projetos individuais;
- projetos de equipe;
- tarefas;
- financeiro;
- notas fiscais;
- documentos.

## 6. Validar persistencia

No Render:

1. Cadastre um registro de teste.
2. Reinicie o servico.
3. Confirme que o registro continua aparecendo.

Se continuar aparecendo, o backend esta usando PostgreSQL e os dados nao dependem mais do arquivo SQLite local do deploy.
