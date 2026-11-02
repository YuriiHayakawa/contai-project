# ADR 0008: política de segurança de conteúdo (CSP)

- **Situação**: aceito
- **Data**: 2026-10-14
- **Referência**: `specs/001-contai-mvp/research.md`, seção 26; constituição, Princípios V e VII

## Contexto

A constituição exige registrar em ADR qualquer concessão na política de segurança de conteúdo. O
design system aprovado trouxe decisões que afetam a CSP: fontes próprias, tema definido antes da
primeira pintura, e bibliotecas (Motion, Recharts) que aplicam estilos pelo atributo `style`.

## Decisão

- **CSP do frontend** (servida pela Vercel, `frontend/vercel.json`; antes, pelo Caddy): `default-src 'self'`, com `script-src 'self'`,
  `style-src 'self'`, `font-src 'self'`, `img-src 'self' data:`, `connect-src 'self'`,
  `frame-ancestors 'none'`, `base-uri 'self'` e `form-action 'self'`. A **única concessão** é
  `style-src-attr 'unsafe-inline'`, porque o Motion e o Recharts aplicam estilos pelo atributo
  `style`.
- **CSP da API**: a mais restrita possível — `default-src 'none'; frame-ancestors 'none'` — porque
  a API só devolve JSON e nada nela deve ser carregado ou executado por um navegador.
- As fontes (Besley e Atkinson Hyperlegible Next) entram como `.woff2` no próprio app; não há
  chamada ao Google Fonts. O tema é definido por um arquivo externo (`public/theme-init.js`), não
  por script embutido, que a CSP bloquearia.
- Em produção, `/api/docs` e `/api/openapi.json` ficam desligados, porque a documentação
  interativa carrega scripts de fora da origem.
- Os cabeçalhos de segurança (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`) são
  definidos na Vercel para as páginas e repetidos pela API nas respostas dela.

## Alternativas rejeitadas

- **Carregar as fontes do Google Fonts**: abriria a CSP para domínios externos e informaria o
  endereço do usuário a terceiros (contra o Princípio VII).
- **`nonce` para estilos embutidos**: não cobre o atributo `style`, que é justamente o que o
  Motion e o Recharts usam.
- **Script de tema embutido na página**: seria bloqueado pela CSP.

## Consequências

- A concessão `style-src-attr 'unsafe-inline'` é a única exceção, registrada aqui como manda a
  constituição; `script-src` continua sem `unsafe-inline` nem `unsafe-eval`.
- Trocar Motion ou Recharts por algo que não use o atributo `style` permitiria remover a
  concessão no futuro.
- A CSP do frontend vive em `frontend/vercel.json` (revisão de 2026-11-02, ADR 0010; conferida
  no ar na validação do deploy); a CSP da API vive em `backend/app/main.py` e é coberta por
  teste.
