# ADR 0010: hospedagem em planos gratuitos (Vercel, Render e Neon)

- **Situação**: aceito
- **Data**: 2026-11-02
- **Emenda relacionada**: constituição 1.0.1 → 2.0.0 (Princípios III e XII, Stack e Dependências)
- **Referência**: `specs/001-contai-mvp/research.md`, seções 1, 24 e 29

## Contexto

O plano original publicava o Contaí numa VPS com Docker Compose atrás do Caddy. O mantenedor
decidiu (2026-10-29) usar só serviços gratuitos e sem cartão. Os limites conferidos nos planos
gratuitos mudam o desenho:

- **Render (API)**: não tem worker, cron nem disco permanente; o serviço dorme depois de 15
  minutos sem acesso e leva cerca de 1 minuto para acordar; as portas de SMTP (25, 465 e 587)
  ficam fechadas para conexões de saída; 512 MB de memória e uma fração de CPU.
- **Neon (PostgreSQL)**: 100 CU-horas por mês, 1 GB por projeto, compute que dorme depois de 5
  minutos e histórico de restauração de 6 horas.
- **Vercel (frontend)**: espera no máximo 120 s pela origem externa; o plano Hobby é para uso
  pessoal, não comercial.

## Decisão

- **Uma única origem.** O site fica na Vercel, que repassa `/api/*` à API no Render
  (`frontend/vercel.json`, `routes`). O cookie de refresh continua `httpOnly`, `Secure` e
  `SameSite=Strict`, sem CORS para outra origem.
- **A API só aceita o que vem pela Vercel.** A Vercel acrescenta a cada requisição repassada o
  cabeçalho `x-contai-proxy-secret` (`transforms` com `set`, a partir de uma variável de
  ambiente); a API recusa com 403 o que chega sem ele, menos o health check que o Render faz
  direto (`app/core/proxy.py`).
- **IP do visitante: a primeira entrada do `X-Forwarded-For`**, só nas requisições com o
  segredo. A Vercel substitui esse cabeçalho pelo IP do visitante, e a Cloudflare e o proxy do
  Render só acrescentam entradas no fim. O diagnóstico dos cabeçalhos no Render (research.md,
  seção 29) descartou os outros: o `X-Vercel-Forwarded-For` deixa passar o valor do cliente em
  POST, o `X-Real-IP` não chega, e o `CF-Connecting-IP` e o `True-Client-IP` trazem o IP da
  Vercel.
- **Nada da API vai para cache**: `Cache-Control: no-store` em todas as respostas, e o cache do
  repasse desligado na Vercel. Os arquivos de `/assets/` (nome com hash) ficam em cache por um
  ano; o `index.html`, com `no-cache`.
- **Cabeçalhos de segurança nas duas camadas**: a Vercel aplica nas páginas a CSP do
  [[0008-politica-de-seguranca-de-conteudo]], HSTS, `nosniff` e `Referrer-Policy`; a API
  continua aplicando os dela.
- **Worker embutido na API**: a fila de jobs ([[0001-fila-de-jobs-no-postgresql]]) é consumida
  por uma tarefa de fundo no processo da API, em produção e no ambiente local.
- **Tarefas agendadas por disparo externo**: um workflow do GitHub Actions no repositório
  principal chama, a cada 3 horas, um endpoint interno protegido por token, que roda as tarefas
  periódicas (exclusões de conta, desativação das duas etapas e seus avisos, limpezas). Elas
  também rodam sempre que o serviço está acordado. A spec aceita até 3 horas de atraso depois
  de cada prazo.
- **Arquivos enviados no banco** até o processamento: ver [[0011-arquivos-enviados-no-banco]].
- **E-mail pela API do Brevo**, sem domínio próprio (o remetente fica no domínio do Brevo). Em
  desenvolvimento continua o Mailpit, por SMTP.
- **Backup** num repositório privado à parte: ver [[0007-backup-cifrado]].
- **Região**: Render e Neon em Ohio (EUA), juntos, porque nenhum dos dois tem região no Brasil
  no plano gratuito e cada consulta atravessaria o continente com eles separados.
- **O serviço não é mantido acordado.** Manter o Render acordado o mês inteiro consumiria cerca
  de 186 CU-horas do Neon, quase o dobro da cota.
- **Deploy pelo CI**: o job de deploy chama os deploy hooks do Render e da Vercel depois dos
  jobs de CI, só na `main`; os deploys automáticos dos dois ficam desligados.
- **Argon2id com m=19 MiB, t=2, p=1**, a primeira configuração recomendada pelo OWASP. Com o
  padrão da biblioteca (64 MiB, t=3, p=4), cada conferência de senha levava cerca de 1,4 s no
  Render; agora leva de 0,1 a 0,2 s.

## Alternativas rejeitadas

- **VPS própria**: custa dinheiro, contra a regra do mantenedor.
- **Manter o serviço acordado com acessos periódicos**: estoura a cota do Neon.
- **Cron do Render ou worker do Render**: não existem no plano gratuito.
- **API em outro domínio, com CORS**: exigiria cookie entre sites e liberar CORS com credenciais.
- **`X-Vercel-Forwarded-For`, `X-Real-IP` ou cabeçalhos da Cloudflare para o IP**: ver acima.
- **E-mail por SMTP**: portas fechadas no Render gratuito. **Resend**: exige domínio verificado.

## Consequências

- O primeiro acesso depois de 15 minutos parado leva cerca de 1 minuto (62,6 s e 63,9 s
  medidos), dentro dos 120 s da Vercel; o app avisa que está acordando o servidor.
- Os contadores de limite de frequência ficam em memória e zeram cada vez que o serviço dorme.
  O bloqueio de login por tentativas erradas fica no banco e não é afetado.
- As requisições que não passam pela Vercel não chegam à API, exceto o health check.
- Os dados ficam nos EUA; a política de privacidade informa a transferência internacional.
- O histórico de restauração do Neon guarda dados apagados por até 6 horas, dentro do prazo de
  14 dias que a política promete para as cópias.
- O plano Hobby da Vercel não admite uso comercial; o Contaí se enquadra enquanto for pessoal e
  de portfólio.
- O ambiente local deixa de ter o contêiner `worker`; a API roda o worker também ali.
