# ADR 0001: fila de jobs no PostgreSQL

- **Situação**: aceito
- **Data**: 2026-10-14
- **Referência**: `specs/001-contai-mvp/research.md`, seção 8; constituição, Princípio III

## Contexto

O Contaí precisa de trabalho fora do ciclo da requisição: enviar e-mails, processar importações,
aplicar exclusões de conta e desativações de duas etapas vencidas, e limpezas periódicas. A
constituição proíbe broker externo (Redis, RabbitMQ) no MVP e já exige PostgreSQL.

## Decisão

Uma tabela `jobs` serve de fila. O worker reserva o próximo job com
`SELECT ... FOR UPDATE SKIP LOCKED`, num laço com espera curta quando não há trabalho. Falha
transitória tenta de novo com backoff exponencial e aleatoriedade até `max_attempts`; um job
preso (worker morto) volta à fila depois de um tempo limite.

As tarefas periódicas rodam no mesmo laço, por intervalo. O acesso às tabelas `jobs` e
`worker_heartbeats` fica só em `worker/repository.py`; os jobs chamam serviços dos módulos e
nunca consultam o banco direto. O payload carrega apenas identificadores — nunca descrição, valor
nem conteúdo de documento. Quando a fila desiste de um job, o worker avisa o módulo dono (quando
ele registrou o aviso), e é assim que uma importação travada vai para `failed`.

A saúde do worker é um batimento em `worker_heartbeats`; `GET /api/v1/health/worker` e o
`healthcheck` do contêiner consideram saudável um batimento com menos de 60 segundos.

## Alternativas rejeitadas

- **`LISTEN/NOTIFY` para acordar o worker**: complexidade sem necessidade; a espera de 1 a 2
  segundos é imperceptível.
- **Biblioteca de fila sobre PostgreSQL**: dependência nova para cerca de cem linhas de código.
- **Broker externo**: proibido no MVP pela constituição.

## Consequências

- Uma peça a menos de infraestrutura: a fila sobe junto com o banco.
- O worker é de instância única; a escala horizontal exigiria revisitar o `SKIP LOCKED` e os
  intervalos das tarefas periódicas.
- Desde 2026-11-02, o worker roda embutido no processo da API, e as tarefas periódicas também
  têm um disparo externo, pelo endpoint interno, porque o serviço dorme sem acessos (ver
  [[0010-hospedagem-em-planos-gratuitos]]). Como o laço e o disparo podem rodar a mesma tarefa
  periódica ao mesmo tempo, cada tarefa roda sob um advisory lock do PostgreSQL próprio dela, e
  quem não pega a trava pula a vez.
- Como o payload só tem ids, todo dado sensível é relido do banco pelo serviço, dentro do job.
