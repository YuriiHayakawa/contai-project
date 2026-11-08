-- Linhas de cada tabela do app, numa consulta só. Serve para comparar uma restauração com o
-- banco de origem (infra/backup/README.md). Roda no Neon e no banco restaurado.
SELECT
    table_name AS tabela,
    (xpath(
        '/row/n/text()',
        query_to_xml(format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name), false, true, '')
    ))[1]::text::bigint AS linhas
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
