<!--
SYNC IMPACT REPORT
==================
Version change: 2.0.0 → 2.1.0
Bump rationale: MINOR. Entram dois princípios novos (XIV. App Mobile e XV. Lançamento por Voz) e
uma linha nova na Stack. Outros seis princípios ganham regras ou remissões. Nenhuma regra é
removida, e nada do que estava conforme deixa de estar. As duas exceções abertas (salvar sem
confirmação no Princípio VI e desfazer sem confirmação no Princípio IX) valem só para o
lançamento por voz, que ainda não existe, então nenhum código atual passa a violá-las. Por isso a
mudança é MINOR, e não MAJOR.

Justificativa: o mantenedor vai construir um app mobile do Contaí em React Native para uma
disciplina da faculdade (trabalho individual, entrega em 2026-11-25), na pasta mobile/ deste
repositório e consumindo a mesma API. Vai também construir o lançamento por voz pela Siri: um
atalho do app Atalhos do iPhone envia a frase falada para a API. O desenvolvimento é feito no
Windows, sem Mac e sem conta paga da Apple, então o app precisa rodar no Expo Go.

Modified principles:
  - Preâmbulo: o Contaí passa a ter também um app mobile e o lançamento por voz.
  - II. Qualidade de Código — Frontend: as regras passam a valer também para o app mobile.
  - V. Segurança: remissões aos Princípios XIV (sessão no app) e XV (tokens pessoais). O token
    pessoal é incluído nos testes de isolamento e no CORS (clientes nativos).
  - VI. Inteligência Artificial: exceção à confirmação para o lançamento por voz (Princípio XV).
  - VII. Privacidade e LGPD: a política de privacidade passa a informar que a frase falada passa
    pela Apple. A exportação e a exclusão da conta passam a cobrir os tokens pessoais.
  - IX. Design e UX: regras de acessibilidade do app (leitor de tela, fonte do sistema, área de
    toque). Desfazer um lançamento por voz deixa de exigir confirmação.
  - X. Testes: testes obrigatórios do app (jest-expo e React Native Testing Library) e do token
    pessoal.
  - XII. Deploy e Infraestrutura: o app e o atalho usam a mesma origem pública. O CI cobre o app.
    O app não é publicado nas lojas.

Added sections:
  - XIV. App Mobile
  - XV. Lançamento por Voz (tokens pessoais)
  - Stack e Dependências: linha "Mobile".

Removed sections: nenhuma.

Templates: não modificados. Os templates e comandos dependentes leem esta constituição em tempo
de execução.

ADR: docs/adr/0012-sessao-no-app-e-tokens-pessoais.md acompanha esta emenda, como a seção de
governança pede para emendas que tocam segurança. A emenda cria um modo de login para clientes
nativos e uma credencial nova, o token pessoal.

Plano de adequação (Governance): nenhum. Nenhum código existente passa a violar a constituição.

Follow-up TODOs:
  - Fonte única do código compartilhado (Princípio XIV): o mantenedor aprovou (2026-11-18) que o
    plano escolha o mecanismo mais simples. Se compartilhar custar mais de meio dia, por causa
    do prazo de 2026-11-25, o plano registra um desvio temporário em vez de travar a entrega.
  - Valores numéricos deixados para a spec: número máximo de tokens pessoais ativos por usuário,
    limite de uso por token e tempo de destaque dos lançamentos por voz.
  - Continuam valendo as pendências externas da versão 1.0.0 que ainda estão abertas.

Desvios temporários: os dois registrados em 2026-11-08 (versão 2.0.0, abaixo) continuam em vigor.
Enquanto o desvio do CI durar, as verificações do app entram em infra/ci-local.sh, como as
demais.

HISTÓRICO
---------
2.0.0 (2026-11-02)
Version change: 1.0.1 → 2.0.0
Bump rationale: MAJOR. O Princípio XII é redefinido de forma incompatível: a produção deixa de
ser uma VPS com Docker Compose atrás do Caddy e passa a usar serviços gerenciados. A seção Stack
e Dependências acompanha ("Ambientes"), e o Princípio III passa a aceitar o worker embutido no
processo da API.

Justificativa: o mantenedor decidiu (2026-10-29) publicar só em planos gratuitos e sem cartão —
frontend na Vercel, API no Render e banco no Neon. O plano gratuito do Render não tem worker,
cron nem disco permanente, e o serviço dorme depois de 15 minutos sem acesso. A validação do
deploy (research.md, seção 29) confirmou o desenho: uma única origem pela Vercel, a API recusando
o que não traz o segredo do proxy, o cookie de refresh intacto, upload de 10 MB, partida a frio
de cerca de 1 minuto e o IP do visitante pela primeira entrada do X-Forwarded-For.

Modified principles:
  - III. Arquitetura — Backend: o worker da fila PODE rodar em processo próprio ou embutido no
    processo da API (antes, "um processo worker").
  - XII. Deploy e Infraestrutura: o Docker Compose fica para o ambiente local; a produção PODE
    usar serviços gerenciados, com uma única origem, a API atrás de um proxy com segredo, HTTPS
    do provedor, cabeçalhos de segurança nas duas camadas e a mesma imagem da API; o backup fica
    fora do provedor do banco; as tarefas agendadas PODEM ter disparo externo.

Added sections: nenhuma.

Removed sections: nenhuma.

Templates: não modificados. Os templates e comandos dependentes leem esta constituição em tempo
de execução.

ADR: docs/adr/0010-hospedagem-em-planos-gratuitos.md acompanha esta emenda, como a seção de
governança pede para emendas que tocam arquitetura e segurança. O ADR 0011 substitui o 0006
(arquivos enviados no banco), e o 0007 foi revisto (backup por GitHub Actions).

Plano de adequação (Governance): o código que a emenda deixa fora do desenho — volume de uploads,
worker em contêiner próprio, envio por SMTP em produção, tarefas periódicas só no laço do worker —
é adaptado pelas tarefas T258 a T264 e T216 a T218 de specs/001-contai-mvp/tasks.md.

Follow-up TODOs:
  - Continuam valendo as pendências externas da versão 1.0.0 que ainda estão abertas (valores
    numéricos deixados para specs e ADRs).

Desvio temporário em vigor (2026-11-08, sem mudança de texto nem de versão; Governance,
Conformidade):
  - XII. Deploy e Infraestrutura, "backup diário automático do PostgreSQL, guardado fora do
    provedor do banco": NÃO atendido por enquanto. A conta do GitHub não tem cartão, e o
    orçamento de US$ 0 bloqueia os Actions do repositório privado contai-backups. Enquanto isso,
    a única cópia é o histórico de restauração do Neon, de poucas horas, dentro do provedor.
  - Justificativa: o mantenedor priorizou colocar o Contaí em uso. Alternativas rejeitadas:
    rodar o backup no repositório principal, que fica público (artifacts baixáveis por qualquer
    conta do GitHub); cadastrar cartão ou usar armazenamento que o exige (contra a regra de só
    usar planos gratuitos sem cartão).
  - Plano de adequação: T216 (backup rodando todos os dias) e T217 (ensaio de restauração),
    adiadas em specs/001-contai-mvp/tasks.md; detalhes no ADR 0007, seção "Desvio temporário".
    A política de privacidade informa o usuário de que as cópias diárias ainda não existem.
  - XII, "O CI no GitHub Actions DEVE executar [...] a cada push. O deploy só PODE acontecer com o
    CI verde": NÃO atendido por enquanto. Desde 2026-11-06 os Actions da conta não rodam
    ("account is locked due to a billing issue"), e o mantenedor não vai cadastrar cartão. O CI
    roda por infra/ci-local.sh antes de cada push, com os mesmos passos do ci.yml; o deploy é
    feito pela integração com o Git do Render e da Vercel a cada merge na main, que só é feito
    com o CI local verde. As tarefas agendadas são disparadas pelo cron-job.org, que acorda a API
    a cada 3 horas pelo health check, sem segredo.
  - Justificativa e alternativas rejeitadas: ADR 0010, seção "Desvio temporário: GitHub Actions
    bloqueados". O desvio acaba quando os Actions da conta voltarem a rodar (T218 volta ao job de
    deploy por deploy hooks).

1.0.1 (2026-10-01)
Version change: 1.0.0 → 1.0.1
Bump rationale: PATCH. A lista de domínios do Princípio III ganha o módulo `categorization`. É um
ajuste da lista, sem mudança de regra: o módulo segue a mesma estrutura dos demais (router →
service → repository → models/schemas) e as mesmas regras de repositório, com `user_id`
obrigatório.

Justificativa (Complexity Tracking de specs/001-contai-mvp/plan.md; tarefa T055): a sugestão de
categoria é usada por três módulos — `imports` (linhas propostas), `transactions` (aprender com
correções) e `assistant` (lançamento por texto). Colocá-la em `categories` misturaria o cadastro
de categorias com regras aprendidas e chamadas à IA; colocá-la em `imports` obrigaria
`transactions` e `assistant` a depender de `imports`.

Modified principles:
  - III. Arquitetura — Backend: lista de domínios passa a incluir `categorization` (título e
    demais regras inalterados).

Added sections: nenhuma.

Removed sections: nenhuma.

Templates: não modificados. Os templates e comandos dependentes leem esta constituição em tempo
de execução. Com a emenda, o desvio registrado no Complexity Tracking do plano deixa de ser um
desvio; o plano não foi alterado por este comando.

ADR: docs/adr/0009-modulo-categorization.md acompanha esta emenda, como a seção de governança
pede para emendas que tocam a arquitetura.

Follow-up TODOs:
  - Continuam valendo as pendências externas da versão 1.0.0 que ainda estão abertas (valores
    numéricos deixados para specs e ADRs).

1.0.0 (2026-10-01)
Version change: (template não preenchido) → 1.0.0
Bump rationale: ratificação inicial da constituição; primeira versão com princípios concretos.

Modified principles: nenhum (primeira versão).

Added sections:
  - Core Principles
      I.    Qualidade de Código — Backend
      II.   Qualidade de Código — Frontend
      III.  Arquitetura — Backend
      IV.   Arquitetura — Frontend
      V.    Segurança
      VI.   Inteligência Artificial
      VII.  Privacidade e LGPD
      VIII. Dados Financeiros
      IX.   Design e UX
      X.    Testes
      XI.   Observabilidade
      XII.  Deploy e Infraestrutura
      XIII. Documentação
  - Stack e Dependências
  - Processo de Desenvolvimento
  - Governance

Removed sections: nenhuma.

Templates: não modificados. Os templates e comandos dependentes leem esta constituição em tempo
de execução.

Follow-up TODOs (nenhum placeholder ficou no documento; itens abaixo são pendências externas):
  - design-system.md: o Princípio IX o define como referência absoluta, mas o arquivo ainda não
    existe no repositório. Precisa ser criado antes da primeira feature com interface.
  - Valores numéricos deixados para specs/ADRs: política mínima de senha, duração dos tokens,
    limites de rate limiting, limite de tamanho de upload, limites de uso de IA por usuário e
    retenção dos backups.
  - O diretório ainda não é um repositório git; Conventional Commits e o CI no GitHub Actions
    dependem de `git init` e de um remoto no GitHub.
-->

# Contaí Constitution

Contaí é uma aplicação web multiusuário de controle financeiro pessoal com assistente de IA, com
um app mobile e lançamento por voz que usam a mesma API. Cada usuário registra suas finanças
manualmente, importando documentos de qualquer banco ou falando com a Siri, e faz perguntas em
linguagem natural sobre os próprios gastos. O sistema é usado de verdade por várias
pessoas, inclusive sem conhecimento técnico, e é peça de portfólio: o padrão exigido é qualidade
de produção.

## Core Principles

As palavras DEVE, NÃO DEVE e PODE indicam, respectivamente, obrigação, proibição e permissão.

### I. Qualidade de Código — Backend

- Todo o código Python DEVE ter type hints, e o mypy em modo strict DEVE passar sem erros.
- Ruff DEVE ser a ferramenta de lint e formatação. Nenhum aviso PODE ser ignorado sem um
  comentário explicando o motivo.
- Schemas Pydantic DEVEM ser separados para entrada (`Create`/`Update`) e saída (`Read`). Modelos
  do ORM NÃO DEVEM ser retornados diretamente pela API.
- Rotas NÃO DEVEM conter lógica de negócio: apenas validam a entrada, chamam serviços e formatam a
  resposta.
- Erros de domínio DEVEM usar exceções próprias, convertidas em respostas HTTP padronizadas em um
  único ponto.
- Funções DEVEM ser pequenas. Nomes no código DEVEM estar em inglês; textos exibidos ao usuário
  DEVEM estar em português do Brasil.

**Rationale**: tipagem estrita e camadas com responsabilidade única tornam os erros visíveis antes
da execução, o que importa em um sistema que lida com dinheiro de pessoas reais.

### II. Qualidade de Código — Frontend

- O TypeScript DEVE rodar com `strict: true`, com zero `any` implícito ou explícito.
- Componentes DEVEM ser funcionais; componentes de classe são proibidos.
- Props DEVEM ser tipadas com interfaces nomeadas. Tipos compartilhados DEVEM ficar em arquivos
  `types.ts` por feature.
- Componentes de UI NÃO DEVEM conter lógica de negócio nem chamadas HTTP. Chamadas à API DEVEM
  ficar em uma camada de serviços e ser consumidas via hooks do TanStack Query.
- Formulários DEVEM ser validados com schemas Zod.
- ESLint e Prettier DEVEM passar sem erros.
- As regras deste princípio valem também para o app mobile em `mobile/` (ver Princípio XIV).

**Rationale**: o mesmo rigor de tipos do backend, com a UI separada do acesso a dados para que
componentes sejam previsíveis e testáveis.

### III. Arquitetura — Backend

- O código DEVE ser organizado por domínio (`auth`, `users`, `accounts`, `categories`,
  `transactions`, `imports`, `categorization`, `dashboard`, `assistant`), cada um com router →
  service → repository → models/schemas.
- Repositórios DEVEM ser o único lugar que acessa o banco. Todo método de repositório que lida
  com dados do usuário DEVE receber o `user_id` como parâmetro obrigatório.
- Importadores de documentos DEVEM ser módulos plugáveis que implementam uma interface comum:
  detectar formato → extrair → normalizar para transações propostas. Adicionar um banco ou
  formato novo NÃO DEVE alterar o núcleo.
- O processamento de importações DEVE ser assíncrono, usando uma fila baseada em tabela de jobs
  no PostgreSQL e um worker, que PODE rodar em processo próprio ou embutido no processo da API.
  Redis ou broker externo NÃO DEVEM ser usados no MVP.
- Configurações DEVEM vir exclusivamente de variáveis de ambiente, lidas por uma classe de
  settings do Pydantic.

**Rationale**: o `user_id` obrigatório no repositório transforma o isolamento entre usuários em
propriedade estrutural, e não em disciplina de quem escreve cada consulta. A fila em tabela evita
infraestrutura que o MVP não precisa.

### IV. Arquitetura — Frontend

- O código DEVE ser organizado por feature em `src/features/<feature>/`, com `components`,
  `hooks`, `services` e `types`. Componentes genéricos reutilizáveis DEVEM ficar em
  `src/components/ui`.
- O fluxo de dados DEVE ser: services (chamadas HTTP) → hooks (TanStack Query) → components (UI).
- Rotas autenticadas DEVEM ser protegidas por um guard único.

**Rationale**: um único caminho para os dados e um único ponto de proteção de rotas eliminam
variações que escondem bugs e falhas de acesso.

### V. Segurança

- O OWASP Top 10 DEVE ser a referência mínima. Qualquer decisão que enfraqueça a segurança DEVE
  ser documentada e justificada em um ADR.
- **Senhas**: DEVEM ser armazenadas com hash Argon2id, com política mínima de senha e checagem
  contra senhas comuns.
- **Tokens**: o access token JWT DEVE ter curta duração e ser mantido apenas em memória no
  frontend. O refresh token DEVE ficar em cookie `httpOnly`, `Secure`, `SameSite=Strict`, com
  rotação a cada uso, detecção de reutilização e revogação no logout e na troca de senha. A
  sessão do app mobile segue o Princípio XIV. Os tokens pessoais do lançamento por voz seguem o
  Princípio XV.
- **CSRF**: o endpoint que usa o cookie de refresh DEVE ter proteção contra CSRF.
- **Cadastro e recuperação**: a verificação de e-mail DEVE ser obrigatória no cadastro. A
  recuperação de senha DEVE usar token de uso único com expiração curta. As respostas NÃO DEVEM
  revelar se um e-mail está cadastrado.
- **Dois fatores**: autenticação TOTP DEVE estar disponível para todos os usuários, com códigos
  de recuperação.
- **Rate limiting**: DEVE existir em login, cadastro, recuperação de senha, uploads e endpoints
  de IA, com bloqueio temporário após tentativas falhas.
- **Isolamento entre usuários**: toda consulta, arquivo, job e conversa DEVE ser filtrado pelo
  usuário autenticado. DEVEM existir testes automatizados que tentam acessar dados de outro
  usuário em todos os endpoints, inclusive com o token pessoal de outro usuário.
- **Uploads**: DEVEM ser tratados como não confiáveis, com limite de tamanho, validação do tipo
  real pelo conteúdo, nomes de arquivo gerados pelo sistema, armazenamento fora de qualquer pasta
  pública e exclusão do arquivo original após o processamento.
- **Segredos**: DEVEM existir apenas em variáveis de ambiente. O `.env` DEVE estar no
  `.gitignore`, e DEVE existir um `.env.example` documentado.
- **Logs**: NÃO DEVEM conter senhas, tokens, conteúdo de documentos, descrições ou valores de
  transações.
- **Transporte**: HTTPS DEVE ser obrigatório em produção, com headers de segurança (CSP, HSTS,
  `X-Content-Type-Options`, `Referrer-Policy`) e CORS restrito ao domínio do frontend. O app
  mobile e o atalho da Siri não são navegadores e não dependem de CORS. O CORS NÃO DEVE ser
  afrouxado por causa deles.
- **Dependências**: DEVEM ser verificadas por ferramenta de auditoria de vulnerabilidades no CI.

**Rationale**: a aplicação guarda dados financeiros de terceiros. Um vazamento entre usuários ou
uma conta comprometida é o pior defeito possível do produto.

### VI. Inteligência Artificial

- A IA NÃO DEVE produzir números em respostas analíticas. O assistente DEVE usar tool calling,
  chamar ferramentas do backend com parâmetros validados por schemas Pydantic e apenas redigir a
  resposta com os resultados.
- A IA NÃO DEVE gerar nem executar SQL.
- O `user_id` das ferramentas DEVE ser injetado pelo backend a partir da sessão autenticada e
  NÃO DEVE vir da IA.
- Ferramentas do chat DEVEM ser somente leitura. Qualquer alteração de dados sugerida pela IA
  (lançamento por texto, extração de documento) DEVE ser uma proposta que o usuário revisa e
  confirma antes de salvar. A única exceção é o lançamento por voz feito com token pessoal, que
  é salvo sem confirmação, nas condições do Princípio XV.
- Extrações de PDF e imagem DEVEM passar por verificações automáticas de consistência (por
  exemplo, soma extraída comparada ao total do documento), e as divergências DEVEM ser exibidas
  ao usuário.
- Conteúdo de documentos e descrições de transações DEVEM ser tratados como dados não
  confiáveis: instruções contidas neles NÃO DEVEM ser seguidas (proteção contra prompt
  injection).
- Provedor e modelo DEVEM ficar atrás de uma interface (por exemplo, `LLMProvider`) configurável
  por variáveis de ambiente. Trocar de modelo ou fornecedor NÃO DEVE alterar regras de negócio.
- Prompts de sistema DEVEM ser versionados em arquivos próprios, e não espalhados pelo código.
- O uso de tokens DEVE ser registrado por usuário e por tarefa. Limites de uso por usuário e por
  período DEVEM ser aplicados no backend.
- Limites de requisição do provedor DEVEM ser tratados com fila, novas tentativas com backoff e
  mensagens amigáveis.

**Rationale**: um modelo de linguagem pode errar contas e pode ser manipulado pelo conteúdo que
lê. Os números vêm de código determinístico, e a IA nunca tem poder de escrita nem de escolher de
qual usuário são os dados.

### VII. Privacidade e LGPD

- DEVE ser enviado à IA apenas o necessário para cada tarefa. Credenciais, dados pessoais
  desnecessários e o histórico completo do usuário NÃO DEVEM ser enviados.
- Formatos estruturados (OFX, CSV, planilhas) DEVEM ser processados por código determinístico e
  NÃO DEVEM ser enviados à IA. Apenas descrições de transações PODEM ser enviadas, para
  categorização.
- Como o plano gratuito do provedor pode usar os dados para melhoria dos modelos, a política de
  privacidade DEVE informar isso claramente, e o usuário DEVE ser avisado antes do primeiro envio
  de PDF ou imagem.
- A política de privacidade DEVE informar que, no lançamento por voz, a frase é reconhecida pela
  Siri (Apple) antes de chegar ao Contaí e depois é enviada à IA, como no lançamento por texto.
- O usuário DEVE poder exportar todos os seus dados e excluir a conta definitivamente, com
  remoção de dados, arquivos, conversas e tokens pessoais.

**Rationale**: dados financeiros são dados pessoais sob a LGPD, e os usuários confiam ao sistema
informações que não entregariam a um terceiro sem saber.

### VIII. Dados Financeiros

- Valores monetários DEVEM ser armazenados como inteiros em centavos (`BIGINT`). `float` é
  proibido para dinheiro em qualquer camada.
- A formatação de moeda DEVE acontecer apenas na exibição, em BRL e no padrão brasileiro
  (R$ 1.234,56).
- Datas de transação DEVEM ser armazenadas como `DATE`, e timestamps como `timestamptz` em UTC.
  Regras de "mês atual" e de períodos DEVEM ser calculadas no fuso `America/Sao_Paulo`.
- Importações DEVEM ser idempotentes: reimportar o mesmo documento ou período NÃO DEVE duplicar
  transações.
- Transferências entre contas próprias NÃO DEVEM contar como receita ou despesa.
- Exclusões que afetam muitos registros (por exemplo, desfazer uma importação) DEVEM ser feitas
  em transação de banco.

**Rationale**: um centavo errado ou uma transação duplicada destrói a confiança no produto.
Inteiros, idempotência e atomicidade eliminam classes inteiras desses erros.

### IX. Design e UX

- A interface DEVE ser mobile-first: todas as telas DEVEM funcionar a partir de 320px de largura.
- O arquivo `design-system.md` DEVE ser seguido como referência absoluta de cores, tipografia,
  espaçamento e componentes.
- A interface DEVE atender ao WCAG 2.1 AA: contraste adequado, navegação por teclado, labels em
  todos os campos, `aria-label` em botões de ícone e foco visível.
- A interface DEVE estar em português do Brasil, com linguagem simples e sem jargão técnico,
  pensada para pessoas sem familiaridade com tecnologia.
- Toda ação assíncrona DEVE ter estado de carregamento, de erro e vazio. Mensagens de erro DEVEM
  dizer o que fazer, e não apenas o que falhou.
- Ações destrutivas DEVEM sempre pedir confirmação. A única exceção é desfazer um lançamento
  feito por voz (Princípio XV), que é feito com um toque.
- A interface DEVE oferecer modo claro e modo escuro.
- No app mobile, o `design-system.md` DEVE ser seguido com as adaptações do celular: tokens de
  cor, tipografia e espaçamento iguais aos do site e componentes nativos equivalentes. O app
  DEVE seguir o tema claro ou escuro do sistema.
- O app mobile DEVE atender ao mesmo nível de acessibilidade do site:
  - todo elemento interativo DEVE ter `accessibilityLabel` e `accessibilityRole` e ser lido
    corretamente pelo VoiceOver;
  - o texto DEVE acompanhar o tamanho de fonte do sistema (Dynamic Type), sem bloquear a escala
    e sem quebrar o layout nos tamanhos maiores;
  - as áreas de toque DEVEM ter no mínimo 44×44 pt;
  - todas as telas DEVEM funcionar na menor tela de iPhone que o Expo Go suporta.

**Rationale**: parte dos usuários não tem familiaridade com tecnologia e usa o celular. Se a
interface não for clara e acessível para eles, o produto não cumpre seu propósito.

### X. Testes

- O backend DEVE ser testado com pytest, com testes obrigatórios para cálculos financeiros, cada
  importador, detecção de duplicatas, autenticação, isolamento entre usuários e cada ferramenta
  da IA.
- Chamadas à IA DEVEM ser substituídas por fakes nos testes. Nenhum teste PODE depender de rede
  externa.
- Testes de integração DEVEM rodar contra PostgreSQL real em container.
- O frontend DEVE ser testado com Vitest e Testing Library nos hooks e nos componentes com
  lógica.
- O app mobile DEVE ser testado com Jest (preset `jest-expo`) e React Native Testing Library
  nos hooks e nos componentes com lógica. São obrigatórios os testes de: guarda e remoção da
  sessão no armazenamento seguro, renovação do access token, guard de rotas autenticadas,
  formulários e desfazer de lançamento por voz.
- O token pessoal DEVE ter testes obrigatórios no backend:
  - todo endpoint fora do lançamento por voz recusa o token;
  - o banco guarda só o hash;
  - a revogação vale na hora;
  - o limite de uso é aplicado;
  - uma frase ambígua não salva nada;
  - a resposta não contém dados além do lançamento feito.
- A cobertura mínima DEVE ser de 80% nos módulos de domínio do backend.
- Nenhuma feature é considerada pronta sem testes passando.

**Rationale**: os testes obrigatórios cobrem exatamente as áreas em que um defeito custa dinheiro
ou privacidade. PostgreSQL real evita que os testes passem com um comportamento que a produção
não tem.

### XI. Observabilidade

- Logs DEVEM ser estruturados (JSON), com request id e sem dados sensíveis (ver Princípio V).
- DEVE existir endpoint de health check para a API e para o worker.
- Erros inesperados DEVEM ser registrados com contexto suficiente para depuração.

**Rationale**: em produção não há depurador. O log é a única forma de entender uma falha, e não
pode se tornar ele mesmo um vazamento de dados.

### XII. Deploy e Infraestrutura

- O ambiente local DEVE subir com Docker Compose (frontend, API com o worker, PostgreSQL e proxy
  reverso) com um único comando.
- A produção PODE usar serviços gerenciados (hospedagem do build estático, da API em contêiner e
  do PostgreSQL), desde que:
  - o navegador veja uma única origem, com as chamadas `/api` repassadas à API por um proxy;
  - a API recuse o que não chega pelo proxy, conferindo um segredo compartilhado;
  - o HTTPS seja obrigatório e os cabeçalhos de segurança venham das duas camadas: o proxy nas
    páginas e a API nas respostas dela;
  - a API rode da mesma imagem Docker usada no ambiente local.
- O frontend DEVE ser servido como build estático do Vite.
- Migrações Alembic DEVEM ser aplicadas automaticamente no deploy. Alterações manuais no banco de
  produção são proibidas.
- Quando a hospedagem não mantém um processo contínuo, as tarefas agendadas PODEM ser disparadas
  por um agendador externo, que chama um endpoint interno protegido por token.
- DEVE existir backup diário automático do PostgreSQL, guardado fora do provedor do banco, com
  retenção definida e procedimento de restauração documentado e testado.
- O CI no GitHub Actions DEVE executar lint, type check, testes e auditoria de dependências a
  cada push, no backend, no frontend e no app mobile. O deploy só PODE acontecer com o CI verde.
- O app mobile e o atalho da Siri DEVEM chamar a API pela mesma origem pública e pelo mesmo
  proxy do site, sempre com HTTPS. NÃO DEVE existir caminho que chegue à API sem passar pelo
  proxy.
- O app mobile não é publicado nas lojas nesta fase. Ele roda pelo Expo Go (Princípio XIV).

**Rationale**: a mesma imagem e o mesmo desenho de rotas (uma única origem, `/api` repassado)
em todos os ambientes eliminam o "funciona na minha máquina" sem obrigar a um servidor próprio; e
um backup que nunca foi restaurado não é um backup.

### XIII. Documentação

- O README DEVE conter visão do projeto, screenshots, arquitetura, decisões técnicas e
  instruções para rodar localmente com um único comando.
- Decisões de arquitetura relevantes DEVEM ser registradas como ADRs curtos em `docs/adr/`.
- A API DEVE ser documentada automaticamente via OpenAPI do FastAPI.

**Rationale**: o projeto é peça de portfólio. Quem avalia precisa entender o que foi construído e
por quê sem ler o código inteiro.

### XIV. App Mobile

- O app DEVE ficar em `mobile/`, no mesmo repositório, e consumir a mesma API. Ele NÃO DEVE ter
  backend próprio nem regra de negócio que a API não tenha: números, saldos e validações finais
  vêm da API.
- **Expo Go**: o app DEVE rodar no Expo Go num iPhone, sem build nativa própria (sem `prebuild`,
  development build, EAS Build nem conta paga da Apple). Só PODEM ser usadas bibliotecas incluídas
  no Expo Go ou escritas só em JavaScript/TypeScript. Uma biblioteca que exige código nativo fora
  do Expo Go é proibida, mesmo que seja melhor.
- **SDK**: o app DEVE usar a versão do Expo SDK que o Expo Go da App Store abre. Se o Expo Go
  passar a exigir um SDK mais novo, atualizar o SDK é prioridade.
- **Arquitetura**: as rotas DEVEM usar o Expo Router em `mobile/app/` e conter só composição de
  tela. O código DEVE ser organizado por feature em `mobile/src/features/<feature>/`, com o
  mesmo fluxo do site: services (HTTP) → hooks (TanStack Query) → components. As rotas
  autenticadas DEVEM ser protegidas por um guard único, no layout do grupo autenticado.
- **Reaproveitamento**: o código reaproveitado do frontend web DEVE ter uma fonte única, e não
  cópias que podem divergir. Isso vale para tipos da API, formatação de dinheiro e datas e
  schemas Zod. O código compartilhado DEVE ser TypeScript puro, sem dependência de DOM, React DOM
  ou Vite. O plano da feature DEVE escolher o mecanismo mais simples de compartilhar esse
  código entre o site e o app. Se compartilhar custar mais de meio dia de trabalho, o app PODE
  usar cópias, mas só com um desvio temporário registrado (Governance, Conformidade). Esse
  registro DEVE listar os arquivos copiados e trazer o plano de adequação.
- **Sessão**: o access token DEVE ficar só em memória. O refresh token DEVE ficar só no
  armazenamento seguro do sistema (`expo-secure-store`, Keychain no iOS). Ele NÃO DEVE ir para
  AsyncStorage, arquivo, log, cache persistido do TanStack Query nem estado de navegação. Ele
  DEVE ser apagado no logout e quando a API o recusar.
- **Login do app**: clientes nativos DEVEM ter um fluxo próprio, em que o refresh token vai no
  corpo da resposta e não em cookie. Esse fluxo DEVE manter todas as regras do Princípio V:
  - verificação de e-mail, TOTP com códigos de recuperação, rate limiting e bloqueio temporário;
  - rotação do refresh token a cada uso, detecção de reutilização e revogação no logout e na
    troca de senha.
- **Separação dos logins**: o login do site NÃO DEVE mudar nem ficar mais fraco. O endpoint de
  refresh por cookie NÃO DEVE aceitar token no corpo, e o endpoint do app NÃO DEVE ler nem gravar
  o cookie. Um refresh token emitido para um tipo de cliente NÃO DEVE ser aceito pelo outro.

**Rationale**: o Expo Go é o único caminho para rodar o app num iPhone a partir do Windows sem
conta paga da Apple. Por isso a restrição de bibliotecas não é negociável: uma única dependência
nativa fora dele impede o app de abrir. No celular não existe cookie `httpOnly` de navegador. O
equivalente seguro é o Keychain, e um fluxo separado impede que a conveniência do app abra uma
porta no login do site. O fluxo do app não precisa de proteção contra CSRF porque não usa nenhuma
credencial que o navegador envie sozinho.

### XV. Lançamento por Voz (tokens pessoais)

- **Token pessoal**:
  - o usuário autenticado gera o token no app ou no site, e ele é exibido uma única vez;
  - o token DEVE ter alta entropia e ser guardado no banco só como hash;
  - cada token tem um nome dado pelo usuário, e a data de criação e a de último uso ficam
    visíveis;
  - o usuário DEVE poder revogar o token a qualquer momento, com efeito imediato;
  - o token DEVE ser revogado também na troca de senha e na exclusão da conta.
- **Escopo único**: o token pessoal DEVE autenticar só o endpoint de lançamento por voz. Todos os
  outros endpoints DEVEM recusá-lo, inclusive os de leitura e os de gerenciar tokens. Ele NÃO
  DEVE dar acesso a saldos, lançamentos, conversas ou qualquer outro dado.
- **Transporte**: o token DEVE ir no cabeçalho `Authorization`, nunca na URL nem no corpo, para
  não aparecer em logs de proxy nem no histórico.
- **Limite de uso**: DEVE haver limite de requisições por token e por usuário. Cada chamada conta
  no limite de uso de IA do usuário (Princípio VI).
- **Entrada**: a frase é dado não confiável e passa pelas mesmas proteções contra prompt
  injection e pelo mesmo caminho do lançamento por texto. Cada frase gera no máximo um
  lançamento. O lançamento por voz NÃO DEVE criar contas, cartões nem categorias. O valor DEVE
  ser validado por schema como inteiro positivo em centavos.
- **Exceção à confirmação**: o usuário ativou o lançamento por voz de forma explícita ao criar o
  token. Por isso o lançamento feito com ele é salvo sem tela de confirmação, e essa é a única
  exceção ao Princípio VI. O lançamento DEVE:
  - ser marcado no banco com a origem "voz";
  - aparecer em destaque no app e no site;
  - poder ser desfeito com um toque, sem confirmação (exceção do Princípio IX).
- **Ambiguidade**: se faltar um dado obrigatório ou ele for ambíguo, nada é salvo, e a resposta
  pede para o usuário repetir a frase. Isso vale, por exemplo, para frase sem valor, valor que
  não dá para interpretar e conta inexistente ou que não dá para identificar.
- **Resposta**: a resposta à Siri DEVE ser uma frase curta em português, que confirma só o
  lançamento feito (valor, descrição ou categoria e conta) ou pede para repetir. Ela NÃO DEVE
  conter saldo, outros lançamentos, dados pessoais nem dados de outras contas. Falhas de
  autenticação DEVEM ter uma resposta genérica, que não diz se o token existiu ou foi revogado.

**Rationale**: um atalho da Siri guarda a credencial fora do Contaí, num app de terceiros. Por
isso essa credencial vale o mínimo possível: um token vazado só permite criar lançamentos
visíveis e fáceis de desfazer. Salvar sem confirmação é o que torna a voz útil, e a marcação, o
destaque e o desfazer com um toque devolvem ao usuário o controle que a confirmação daria.

## Stack e Dependências

A stack abaixo é obrigatória. Substituir qualquer item exige emenda desta constituição.

- **Backend**: Python 3.12+, FastAPI, SQLAlchemy 2.0 (async), Alembic para migrações, Pydantic v2
  para validação e configurações, uv para gerenciar dependências.
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query para
  estado de servidor, React Hook Form + Zod para formulários, Recharts para gráficos e
  lucide-react para ícones.
- **Mobile**: React Native com Expo (SDK que o Expo Go da App Store abre) e TypeScript estrito,
  Expo Router, TanStack Query, React Hook Form + Zod e `expo-secure-store` para a sessão. Toda
  biblioteca DEVE ser compatível com o Expo Go (ver Princípio XIV).
- **Banco de dados**: PostgreSQL.
- **Ambientes**: local via Docker Compose; produção em serviços gerenciados, com a mesma imagem
  da API (ver Princípio XII).
- **IA**: Google Gemini (plano gratuito no início), sempre acessado por uma camada de abstração
  própria (ver Princípio VI).

Toda nova dependência DEVE ter justificativa registrada. A biblioteca padrão e as bibliotecas já
adotadas DEVEM ser preferidas.

## Processo de Desenvolvimento

- **Orientado a especificação**: nenhuma funcionalidade PODE ser implementada sem spec aprovada.
- **Commits**: DEVEM seguir Conventional Commits.
- **Simplicidade primeiro**: DEVE ser construído o MVP definido na spec, sem funcionalidades
  especulativas nem abstrações prematuras. As abstrações exigidas por esta constituição (camadas
  router → service → repository, interface de importadores, `LLMProvider`) não são consideradas
  prematuras; qualquer outra DEVE ser justificada no plano da feature.
- **Pronto**: uma feature só é considerada pronta com os testes passando (Princípio X) e o CI
  verde (Princípio XII).

## Governance

Esta constituição prevalece sobre qualquer outra prática, documento ou convenção do projeto. Em
caso de conflito, a constituição vence até ser emendada.

**Emendas**: toda alteração DEVE ser feita neste arquivo, com a justificativa registrada no Sync
Impact Report no topo do documento e aprovada pelo mantenedor do projeto. Emendas que mudam
arquitetura ou segurança DEVEM ser acompanhadas de um ADR em `docs/adr/`. Código existente que
passe a violar um princípio emendado DEVE ter um plano de adequação.

**Versionamento**: a versão segue versionamento semântico.

- MAJOR: remoção ou redefinição incompatível de princípios ou de regras de governança.
- MINOR: novo princípio ou seção, ou orientação materialmente ampliada.
- PATCH: esclarecimentos, ajustes de redação e correções sem mudança de significado.

**Conformidade**: todo plano de feature DEVE passar pela verificação de conformidade com esta
constituição antes da implementação, e toda revisão de código DEVE verificar a aderência aos
princípios. Um desvio só é aceito quando documentado com justificativa e com a alternativa mais
simples que foi rejeitada; desvios que enfraquecem a segurança seguem o Princípio V.

**Version**: 2.1.0 | **Ratified**: 2026-10-01 | **Last Amended**: 2026-11-18
