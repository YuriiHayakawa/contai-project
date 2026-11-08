-- Usuário só de leitura do backup diário (ADR 0007). Ver infra/backup/README.md.
--
-- Rodar no SQL Editor do Neon, no ramo production (o mesmo do Render) e no banco do app, como o
-- mesmo papel do DATABASE_URL do Render (o dono das tabelas, normalmente neondb_owner): os
-- privilégios padrão do fim valem para as tabelas que esse papel criar nas próximas migrações.
--
-- O papel é criado por SQL de propósito: um papel criado pelo painel do Neon entra no
-- neon_superuser e deixa de ser só de leitura.
--
-- Troque COLE_A_SENHA_AQUI pela senha antes de rodar, não salve este arquivo com ela e apague a
-- consulta do histórico do SQL Editor depois.

CREATE ROLE contai_backup WITH LOGIN PASSWORD 'COLE_A_SENHA_AQUI';
ALTER ROLE contai_backup SET default_transaction_read_only = on;

DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO contai_backup', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO contai_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO contai_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO contai_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO contai_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO contai_backup;

-- Conferência: as três primeiras colunas devem vir false, e rolconfig deve trazer
-- default_transaction_read_only=on.
SELECT
    rolsuper,
    rolcreaterole,
    pg_has_role('contai_backup', 'neon_superuser', 'member') AS neon_superuser,
    rolconfig
FROM pg_roles
WHERE rolname = 'contai_backup';
