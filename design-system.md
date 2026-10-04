# Contaí — Design System

Referência absoluta de cores, tipografia, espaçamento e componentes do Contaí (Princípio IX da
constituição). Toda tela segue este documento; o que não estiver aqui é decidido estendendo
estas regras, e não importando o padrão de outra biblioteca.

Este documento define o sistema. Ele não descreve telas.

## 1. Direção estética: a caderneta

O Contaí parece uma **caderneta de contas bem cuidada**: papel creme, tinta azul de caneta e um
traço de marca-texto no número que importa. É o objeto que muita gente já usou para anotar os
gastos da casa, e por isso transmite confiança sem parecer um banco nem um painel corporativo.

- **Confiança** vem da tinta azul sobre papel, de números grandes e alinhados e de uma letra
  desenhada para não deixar dúvida entre `0` e `O` ou entre `1` e `l`.
- **Clareza** vem de uma informação principal por tela, texto em tamanho generoso e nenhuma
  informação transmitida só por cor.
- **Calma** vem de poucos elementos, movimento contido e de um extrato que não é uma parede de
  vermelho: despesas são escritas em tinta comum, com sinal de menos.

Três elementos dão a identidade e não podem ser trocados por equivalentes genéricos:

1. **Marca-texto**: um traço amarelo atrás do número principal da tela. Um por tela, no máximo.
2. **Pauta e margem**: listas separadas por linhas finas, como papel pautado, com uma linha de
   margem vertical na lista de transações.
3. **Títulos em Besley**: uma serifa de traço firme, de letreiro e de livro-caixa, contra um
   texto de leitura muito limpo.

### O que evitar

- Fontes genéricas: Inter, Roboto, Open Sans, Lato, Arial, fontes de sistema, Space Grotesk.
- Gradiente roxo, fundo branco puro com cinzas neutros, brilhos e "faíscas" para indicar IA.
- Cartão com sombra para tudo, grade de indicadores no topo, rosca de categorias: o visual de
  painel SaaS.
- Paletas tímidas, com várias cores no mesmo peso. Aqui o papel e a tinta dominam, e o
  marca-texto é o único acento forte.
- Pílulas e cantos totalmente arredondados em tudo.

## 2. Cores

As cores são tokens semânticos. Componentes usam o token, nunca o valor em hexadecimal, e nunca a
paleta padrão do Tailwind, que fica desativada (seção 10).

### 2.1 Base

| Token | Claro (Papel) | Escuro (Noite) | Uso |
|-------|---------------|----------------|-----|
| `--bg` | `#F5F0E6` | `#10152A` | fundo da página |
| `--bg-sunken` | `#ECE5D6` | `#0B0F20` | áreas rebaixadas, trilhos, campo desativado |
| `--surface` | `#FFFDF8` | `#182040` | cartões, campos, barra de navegação |
| `--surface-raised` | `#FFFFFF` | `#202A52` | modais, folhas, menus, toasts |
| `--border` | `#DDD3C0` | `#2C3763` | linhas de pauta e contornos decorativos |
| `--border-strong` | `#877E6C` | `#7C87B5` | contorno de campos e controles (3:1 ou mais) |
| `--ink` | `#1A2238` | `#EFE9DC` | texto principal e valores |
| `--ink-muted` | `#525C75` | `#B3B9D1` | texto secundário |
| `--ink-subtle` | `#586077` | `#969DBC` | placeholders, eixos de gráfico, metadados |
| `--primary` | `#2A3FB0` | `#9DAEFF` | tinta azul: ações, links, item ativo, foco |
| `--primary-hover` | `#22348F` | `#B4C1FF` | hover e pressionado |
| `--on-primary` | `#FFFFFF` | `#10152A` | texto sobre `--primary` |
| `--primary-soft` | `#E4E8FA` | `#263161` | fundo de item ativo e de destaque suave |
| `--highlight` | `#FFE066` | `#5E4B00` | marca-texto; só como fundo, atrás de `--ink` |
| `--margin-line` | `#E3A996` | `#6B3A2C` | linha de margem; decorativa |
| `--scrim` | `rgb(26 34 56 / 0.5)` | `rgb(5 8 18 / 0.65)` | véu atrás de modais |

O tema escuro não é o claro invertido: é papel-carbono azul-marinho com tinta clara, com valores
escolhidos e conferidos um a um.

### 2.2 Semânticas

| Token | Claro | Escuro | Uso |
|-------|-------|--------|-----|
| `--income` | `#136F58` | `#6FD3B0` | receita: valor, ícone e rótulo |
| `--income-soft` | `#D9F0E8` | `#123A30` | fundo de selo de receita |
| `--expense` | `#AD4328` | `#F0977C` | despesa em resumos e indicadores |
| `--expense-soft` | `#F8E3DB` | `#4A2219` | fundo de selo de despesa |
| `--warning` | `#8A5300` | `#F2C14E` | alerta: divergência, possível duplicata, limite próximo |
| `--warning-soft` | `#FCEFC9` | `#45360B` | fundo de aviso |
| `--danger` | `#B4232F` | `#FF8F96` | erro e ação destrutiva |
| `--danger-soft` | `#FADFE1` | `#4D1A20` | fundo de mensagem de erro |
| `--on-danger` | `#FFFFFF` | `#2A0A0E` | texto sobre `--danger` |

Regras de uso:

- **Cor nunca é o único sinal.** Receita leva `+` e seta para cima; despesa leva `−` (U+2212) e
  seta para baixo; alerta e erro levam ícone e texto.
- **Despesa na lista é tinta comum.** Em listas de transações, o valor de uma despesa usa
  `--ink` com `−`; só a receita é colorida. `--expense` fica para resumos ("Saídas do mês"),
  selos e gráficos. Assim o extrato não vira uma tela de alarme.
- **Despesa não é erro.** `--expense` (terracota) e `--danger` (carmim) são tons diferentes e
  nunca aparecem no mesmo papel: `--danger` só em validação, falha e ação destrutiva.
- **Marca-texto não é alerta.** `--highlight` só existe como traço atrás de texto; alerta é
  sempre `--warning` com ícone, em bloco com fundo `--warning-soft`.

### 2.3 Categorias

Oito cores de identidade, mais uma neutra. **A cor de uma categoria só pode ser uma das oito
cores desta paleta**: não existe cor livre, seletor de cor nem valor em hexadecimal. Ao criar ou
editar uma categoria, o usuário escolhe entre oito amostras, cada uma com o nome escrito ao
lado, e o banco guarda o nome do token (por exemplo, `caqui`). Duas categorias podem usar a
mesma cor. A neutra, `ardosia`, não aparece na escolha: é reservada à categoria "Outros" e ao
agrupamento "Outras" dos gráficos.

| Token | Nome | Claro | Escuro | Categoria padrão |
|-------|------|-------|--------|------------------|
| `--cat-tinta` | azul | `#2F5FD0` | `#6088EC` | Transporte |
| `--cat-caqui` | laranja | `#D9621E` | `#DD7435` | Alimentação |
| `--cat-piscina` | verde-água | `#12998A` | `#22A595` | Assinaturas |
| `--cat-mostarda` | mostarda | `#A67C00` | `#B58A18` | Salário |
| `--cat-goiaba` | rosa | `#D6568F` | `#DC6397` | Lazer |
| `--cat-mata` | verde | `#3F8F3A` | `#50A64B` | Moradia |
| `--cat-ameixa` | roxo | `#7B4CC2` | `#9B76E0` | Educação |
| `--cat-pitanga` | vermelho | `#C4384A` | `#E5566A` | Saúde |
| `--cat-ardosia` | neutro | `#7A8296` | `#8A93B5` | Outros, e o agrupamento "Outras" (reservada) |

Regras de uso:

- Nenhuma cor de categoria existe fora desta tabela. Acrescentar uma nona cor exige validá-la
  com as outras oito, nos dois temas, antes de entrar aqui.
- A cor acompanha a categoria em todo o app e nunca muda conforme a posição em um ranking.
- A cor de categoria é sempre **preenchimento**, nunca cor de texto. O selo de categoria é um
  círculo preenchido com a cor e o ícone em `--surface`; o nome fica ao lado, em `--ink`.
- Nesta ordem, as oito cores passam na validação de separação para daltonismo (protanopia e
  deuteranopia) entre vizinhas, nos dois temas. Como o usuário escolhe qual das oito cada
  categoria usa, duas categorias quaisquer podem ficar lado a lado, e nem todos os pares são
  distinguíveis só pela cor (por exemplo, `mata` e `pitanga` para quem tem deuteranopia). Duas
  regras compensam isso e valem sempre:
  1. preenchimentos de categorias diferentes nunca se encostam em um gráfico;
  2. toda categoria aparece com ícone e nome, nunca só com a cor.

### 2.4 Gráficos

| Token | Claro | Escuro | Uso |
|-------|-------|--------|-----|
| `--chart-income` | `#1E9E7E` | `#2FA789` | barras de entradas |
| `--chart-expense` | `#A33D24` | `#B94E33` | barras de saídas |
| `--chart-single` | `#2F5FD0` | `#6088EC` | gráficos de uma única série |
| `--chart-grid` | `#DDD3C0` | `#2C3763` | linhas de grade |

`--chart-income` e `--chart-expense` são passos próprios para preenchimento, diferentes dos tokens
de texto `--income` e `--expense`. O par foi escolhido com diferença de luminosidade para
continuar distinguível com daltonismo vermelho-verde.

### 2.5 Contraste conferido

Calculado pela fórmula da WCAG 2.1. Texto exige 4,5:1; contornos de controle e marcas de
gráfico exigem 3:1.

| Par | Claro | Escuro |
|-----|-------|--------|
| `--ink` sobre `--bg` / `--surface` | 13,9 / 15,5 | 14,9 / 13,2 |
| `--ink-muted` sobre `--bg` / `--surface` | 5,9 / 6,6 | 9,3 / 8,2 |
| `--ink-subtle` sobre `--bg-sunken` (pior caso) | 5,0 | 7,1 |
| `--primary` sobre `--bg` / `--surface` | 7,6 / 8,5 | 8,5 / 7,5 |
| `--on-primary` sobre `--primary` | 8,6 | 8,5 |
| `--ink` sobre `--highlight` | 12,1 | 7,0 |
| `--income` sobre `--bg` / `--income-soft` | 5,4 / 5,1 | 10,0 / 6,9 |
| `--expense` sobre `--bg` / `--expense-soft` | 5,1 / 4,7 | 8,1 / 6,1 |
| `--warning` sobre `--bg` / `--warning-soft` | 5,6 / 5,5 | 10,8 / 7,0 |
| `--danger` sobre `--bg` / `--danger-soft` | 5,7 / 5,2 | 8,3 / 6,5 |
| `--on-danger` sobre `--danger` | 6,5 | 8,4 |
| `--border-strong` sobre `--bg` / `--surface` | 3,5 / 4,0 | 5,2 / 4,5 |
| cores de categoria sobre `--surface` (menor valor) | 3,5 | 4,4 |
| `--chart-income` / `--chart-expense` sobre `--surface` | 3,3 / 6,4 | 5,3 / 3,2 |

Consequências:

- `--border` (1,5:1 ou menos) é só decorativo. Todo campo e controle usa `--border-strong`.
- Gráficos são sempre desenhados sobre `--surface`, nunca direto sobre `--bg`: no tema claro,
  `--chart-income` não chega a 3:1 sobre o fundo da página.
- Qualquer cor nova precisa passar pelos mesmos cálculos antes de entrar neste documento.

## 3. Tipografia

Duas famílias do catálogo do Google Fonts, ambas variáveis e de licença aberta.

| Papel | Família | Pesos usados | Por quê |
|-------|---------|--------------|---------|
| Títulos | **Besley** | 600, 700, 800 | serifa de traço firme, de letreiro e livro-caixa; dá a voz da marca |
| Texto, interface e números | **Atkinson Hyperlegible Next** | 400, 600, 700, 800 | desenhada para máxima distinção entre letras e algarismos; tem algarismos tabulares |

- Pilhas: `"Besley", ui-serif, Georgia, serif` e
  `"Atkinson Hyperlegible Next", ui-sans-serif, system-ui, sans-serif`.
- As fontes são **servidas pelo próprio app** (arquivos `.woff2` variáveis dentro do build), e
  não pelo endereço do Google Fonts. Assim a política de segurança de conteúdo fica restrita à
  própria origem e nenhum acesso do usuário é informado a terceiros.
- `font-display: swap`; a fonte de texto é pré-carregada.
- Besley só em títulos e na marca. Nunca em valores, botões, rótulos ou texto corrido.

### 3.1 Escala

Tamanhos em `rem` (16px de base). O texto de leitura nunca fica abaixo de 14px.

| Token | Fonte | Tamanho / altura | Peso | Uso |
|-------|-------|------------------|------|-----|
| `display` | Besley | 32 / 38 (40 / 46 a partir de `lg`) | 700 | boas-vindas, estado vazio de primeira vez |
| `title-1` | Besley | 24 / 30 | 700 | título da página |
| `title-2` | Besley | 20 / 26 | 600 | título de seção, de modal e de estado vazio |
| `title-3` | Atkinson | 17 / 24 | 700 | título de cartão e de grupo |
| `body` | Atkinson | 16 / 24 | 400 | texto padrão, campos |
| `body-strong` | Atkinson | 16 / 24 | 700 | ênfase, descrição da transação |
| `label` | Atkinson | 14 / 20 | 600 | rótulos de campo, botões compactos, abas |
| `small` | Atkinson | 14 / 20 | 400 | ajuda, metadados, mensagens de campo |
| `micro` | Atkinson | 12 / 16 | 600 | eixos de gráfico, rótulo da barra inferior, selos |

- Contraste de peso forte: 400 contra 700 ou 800, não 400 contra 500.
- Títulos em Besley com `letter-spacing: -0.01em`.
- Sem texto todo em maiúsculas, exceto siglas.
- Linhas de texto corrido com no máximo 65 caracteres.

### 3.2 Valores em reais

Todo valor monetário usa Atkinson Hyperlegible Next com **algarismos tabulares**
(`font-variant-numeric: tabular-nums lining-nums`), pela classe utilitária `money` (seção 10).
Isso mantém as casas alinhadas nas listas e impede que o número "dance" ao trocar de mês.

| Token | Tamanho / altura | Peso | Uso |
|-------|------------------|------|-----|
| `money-hero` | 40 / 44 (48 / 52 a partir de `lg`) | 800 | o número principal da tela; recebe o marca-texto |
| `money-lg` | 24 / 30 | 700 | totais de cartão, fatura, saldo de conta |
| `money-md` | 16 / 24 | 700 | linhas de lista |
| `money-sm` | 14 / 20 | 600 | subtotais, eixos, legendas |

- Formato sempre `R$ 1.234,56`, com espaço não separável depois de `R$` e sem quebra de linha.
- Em `money-hero`, o `R$` tem metade do tamanho e peso 400, alinhado pela linha de base.
- Negativo usa o sinal de menos tipográfico `−` antes do `R$`: `−R$ 45,90`.
- O valor aparece pronto. Nunca há animação de contagem.

## 4. Espaçamento e layout

- Base de 4px, pela escala padrão do Tailwind (`1` = 4px). Valores usuais: 4, 8, 12, 16, 24, 32,
  48. Não usar valores fora da escala.
- Entre elementos de um mesmo grupo: 8 ou 12. Entre grupos: 24. Entre seções: 32.
- Margem lateral da página: 16px até `sm`; 24px de `sm` a `lg`; 32px a partir de `lg`.
- Largura máxima do conteúdo: 720px para listas e formulários; 1120px para o painel.
- **Mobile-first a partir de 320px**: toda tela é desenhada primeiro em uma coluna de 320px, sem
  rolagem horizontal.
- Pontos de quebra do Tailwind: `sm` 640, `md` 768, `lg` 1024, `xl` 1280. A navegação muda em
  `lg`.
- Área de toque mínima de 44 × 44px para qualquer controle, com pelo menos 8px entre alvos.
- Respeitar `env(safe-area-inset-*)` na barra inferior, nas folhas e no campo do chat.
- Alturas com `dvh`, para o teclado virtual não cobrir o conteúdo.

## 5. Bordas, raios, sombras e fundo

### Bordas

- Linha de pauta e contorno de cartão: 1px `--border`.
- Campos e controles: 1,5px `--border-strong`.
- Foco: `outline: 2px solid var(--primary)` com `outline-offset: 2px`, sempre visível em
  `:focus-visible`. Usa `outline`, e não sombra, para sobreviver ao modo de alto contraste.

### Raios

| Token | Valor | Uso |
|-------|-------|-----|
| `--radius-sm` | 6px | selos, etiquetas, sugestões |
| `--radius-md` | 10px | botões, campos |
| `--radius-lg` | 16px | cartões, toasts |
| `--radius-xl` | 24px | cantos superiores de folhas; modais |
| `--radius-full` | 9999px | selo de categoria, avatar, botão de lançar |

### Sombras

O papel é plano: **cartões não têm sombra**, só contorno. Sombra é reservada ao que flutua.

| Token | Claro | Uso |
|-------|-------|-----|
| `--elev-1` | `0 1px 2px rgb(26 34 56 / 0.08)` | botão de lançar, menus pequenos |
| `--elev-2` | `0 6px 16px -4px rgb(26 34 56 / 0.14)` | toasts, menus, tooltip de gráfico |
| `--elev-3` | `0 20px 48px -12px rgb(26 34 56 / 0.24)` | modais e folhas |

No tema escuro a sombra quase não aparece: usar as mesmas posições com `rgb(0 0 0 / 0.5)` e
deixar a diferença entre `--surface` e `--surface-raised`, mais o contorno, fazer a separação.

### Fundo

O fundo da página não é uma cor chapada: é papel.

- **Pontilhado**: pontos de 1px em `--border`, a cada 20px, feitos com `radial-gradient`. É
  quase imperceptível e some atrás dos cartões.
- **Mancha de tinta**: no topo da página, uma aguada radial de `--primary-soft` que se dissolve
  em `--bg` nos primeiros 240px.
- Nada de imagem, textura em arquivo ou gradiente colorido. Texto corrido fica sempre sobre
  `--surface`; sobre o fundo só vão títulos de página.

## 6. Componentes base

Todos ficam em `src/components/ui`. Todo componente interativo tem os estados padrão, hover,
foco visível, pressionado, desativado e, quando faz sentido, carregando.

### 6.1 Botão

| Variante | Aparência | Uso |
|----------|-----------|-----|
| `primary` | fundo `--primary`, texto `--on-primary` | a ação principal; uma por tela |
| `secondary` | fundo `--surface`, contorno `--border-strong`, texto `--ink` | ação alternativa, "Cancelar" |
| `ghost` | sem fundo, texto `--primary` | ação terciária, dentro de listas e cartões |
| `danger` | fundo `--danger`, texto `--on-danger` | confirmar ação destrutiva |

- Altura de 48px (padrão) ou 40px (`compact`, só em telas a partir de `lg` ou dentro de linhas).
  Raio `--radius-md`, texto 16px peso 700, espaço interno horizontal de 20px.
- Em formulários no celular, ocupa a largura toda.
- Hover: `--primary-hover` (ou `--bg-sunken` nas variantes sem fundo). Pressionado: escala 0,98.
- Desativado: fundo `--bg-sunken`, texto `--ink-subtle`, sem contorno, `aria-disabled`.
- Carregando: o rótulo fica, um indicador giratório entra à esquerda, a largura não muda,
  `aria-busy="true"`, cliques ignorados.
- Rótulo com verbo e objeto: "Salvar lançamento", e não "OK".
- Botão só de ícone: 44 × 44px, com `aria-label`.

### 6.2 Campo de texto

- Rótulo sempre visível acima do campo (`label`), ligado por `for`/`id`. O placeholder nunca
  substitui o rótulo.
- Campo com 48px de altura, texto de 16px (evita o zoom automático no iPhone), fundo
  `--surface`, contorno de 1,5px `--border-strong`, raio `--radius-md`, espaço interno de 14px.
- Campo opcional é marcado com "(opcional)" no rótulo; não se usa asterisco.
- Ajuda abaixo do campo em `small` `--ink-muted`.
- Foco: contorno `--primary` mais o anel de foco.
- Erro: contorno de 2px `--danger`, ícone e mensagem em `small` `--danger` abaixo do campo,
  ligada por `aria-describedby`, com `aria-invalid="true"`. A mensagem diz como corrigir.
- Desativado: fundo `--bg-sunken`, texto `--ink-subtle`.
- Seleção, data e área de texto seguem o mesmo desenho; no celular, data usa o seletor nativo.
- Senha tem botão de mostrar e ocultar. Código de verificação usa `inputmode="numeric"` e
  `autocomplete="one-time-code"`.

### 6.3 Campo de dinheiro

É o centro do formulário de lançamento.

- Prefixo `R$` fixo e valor em `money-hero`, alinhados à esquerda, sobre uma linha de pauta de
  2px `--border-strong` no lugar da caixa. No foco, a linha vira `--primary`.
- **Digitação de caixa registradora**: os algarismos entram pela direita. Digitar `4`, `5`, `9`,
  `0` mostra `0,04`, `0,45`, `4,59`, `45,90`. Apagar remove o último algarismo.
- `inputmode="numeric"`; aceita colar `1.234,56` ou `1234.56`.
- O valor é sempre positivo. O sinal vem do seletor Despesa / Receita / Transferência, que fica
  junto do campo. Com "Receita", o valor fica em `--income`; nos demais, em `--ink`.
- Internamente o valor é um inteiro em centavos; não há número de ponto flutuante.
- `aria-label="Valor em reais"`. Erros seguem o campo de texto.

### 6.4 Cartão

- Fundo `--surface`, contorno de 1px `--border`, raio `--radius-lg`, espaço interno de 16px
  (20px a partir de `sm`), sem sombra.
- Título em `title-3`; no máximo uma ação no cabeçalho, em `ghost`.
- Cartão clicável: a área inteira é o alvo; hover com fundo `--bg-sunken`.
- Não aninhar cartões. Dentro de um cartão, a separação é por linha de pauta.
- Cartão de destaque: fundo `--primary-soft` e sem contorno; no máximo um por tela.

### 6.5 Modal

- **No celular é uma folha**: sobe da base, cantos superiores `--radius-xl`, alça de arrasto,
  altura máxima de `90dvh`, rolagem interna e espaço para a área segura.
- **A partir de `md` é um diálogo** centralizado, com 480px de largura (560px para formulários) e
  raio `--radius-xl`.
- Fundo `--surface-raised`, sombra `--elev-3`, véu `--scrim`.
- `role="dialog"`, `aria-modal="true"`, título ligado por `aria-labelledby`, foco preso dentro, e
  o foco volta ao elemento de origem ao fechar. Fecha por botão, `Esc` e toque no véu, exceto
  quando há dados digitados e não salvos.
- Ações no rodapé: empilhadas e de largura total no celular, com a principal em cima; alinhadas
  à direita no desktop.
- **Confirmação destrutiva**: o título é a pergunta com o objeto ("Excluir este lançamento?"), o
  corpo diz a consequência, e os botões são "Cancelar" (`secondary`) e o verbo da ação
  (`danger`). O foco inicial fica em "Cancelar".

### 6.6 Lista de transações

- Agrupada por dia. O cabeçalho do grupo fica fixo ao rolar: data por extenso à esquerda ("Hoje",
  "Ontem", "seg., 28 de set.") em `label` `--ink-muted`, e o total do dia à direita em
  `money-sm`.
- **Pauta e margem**: linhas separadas por 1px `--border`; uma linha vertical de 2px
  `--margin-line` corre a 54px da borda esquerda da lista, em todas as larguras. Os selos ficam
  na margem, à esquerda da linha, e o texto à direita, como em um caderno.
- Linha com altura mínima de 64px:
  - selo de categoria de 36px (círculo preenchido, ícone em `--surface`);
  - descrição em `body-strong`, em até duas linhas, com reticências depois disso;
  - metadados em `small` `--ink-muted`, em uma linha com reticências: categoria · conta, e
    "3/10" em compra parcelada;
  - valor à direita em `money-md`: despesa em `--ink` com `−`; receita em `--income` com `+`;
    transferência em `--ink-muted` com ícone de setas, com o sinal da conta da linha (`−` na que
    sai, `+` na que entra) e "saiu de" ou "entrou em" nos metadados.
- **Transferência com os dois lados na lista**: vira uma linha só, desenhada como um trajeto de
  mapa. A descrição ocupa a largura toda; embaixo, duas paradas ligadas por um pontilhado de 2px
  `--ink-subtle`: "Saiu de Investimento" e "Entrou em Conta Principal", em `small`
  `--ink-muted`, com o nome da conta no mesmo tom. Cada parada é um círculo de 22px com o
  ícone do tipo de conta (12px): a origem vazada (`--surface`, contorno `--border-strong`) e o
  destino em `--primary` sobre `--primary-soft`. O valor de cada parada fica à direita em
  `money-sm` `--ink-muted`, com `−` e `+`. O verde fica para receita: transferência não é gasto
  nem ganho.
- A linha inteira é um botão que abre o detalhe. Não há ação por deslizar.
- Carregando: 5 linhas de esqueleto. Vazio: estado vazio. Erro: mensagem com "Tentar de novo".
- Lista longa: carregar mais ao rolar, sempre com um botão "Carregar mais" como alternativa.
- **Filtros da lista**: o período fica sempre visível. Até `sm`, os demais filtros ficam atrás
  de um único botão "Filtros", que abre uma folha; a partir de `sm`, cada filtro tem o próprio
  seletor. Os botões de filtro têm contorno de 1,5px `--border-strong`, raio `--radius-sm`,
  44px de altura e texto em `label`.
- **Modo de revisão** (importação): caixa de seleção de 24px com alvo de 44px à esquerda; linhas
  desmarcadas usam `--ink-muted` e o texto "Não será importada"; possível duplicata leva o selo
  "Possível duplicata" em `--warning` sobre `--warning-soft`, com ícone.

### 6.7 Estado vazio

- Ícone de 32px em `--primary` dentro de um círculo de 72px `--primary-soft`; título em `title-2`
  (Besley); uma frase em `body` `--ink-muted`; uma ação `primary`.
- Três tipos: **primeira vez** (convida e diz o que fazer: "Cadastre sua primeira conta"),
  **sem resultados** (oferece "Limpar filtros"), **erro** (oferece "Tentar de novo").
- Centralizado, com largura máxima de 320px. Sem ilustração genérica de banco de imagens.

### 6.8 Toast

- Fundo `--surface-raised`, contorno de 1px `--border`, sombra `--elev-2`, raio `--radius-lg`,
  ícone à esquerda na cor do tipo e texto em `body` `--ink`.
- Posição: no celular, na base, acima da barra inferior; a partir de `lg`, no canto superior
  direito. No máximo três empilhados.
- Duração: 5 segundos; 8 segundos se tiver ação ("Desfazer"). Pausa com o foco ou o ponteiro em
  cima. Sempre tem botão de fechar com alvo de 44px.
- Sucesso e informação usam `role="status"`; erro usa `role="alert"` e não some sozinho.
- Erro de formulário nunca vai só em toast: aparece junto do campo.

### 6.9 Navegação

**Barra inferior (até `lg`)**

- Fixa na base, altura de 64px mais a área segura, fundo `--surface`, linha superior de 1px
  `--border`.
- Cinco posições: Início, Lançamentos, **Lançar**, Assistente, Mais.
- "Lançar" é o botão central: círculo de 56px em `--primary`, ícone `+` em `--on-primary`,
  elevado 12px acima da barra, com `--elev-1`. Abre a folha de novo lançamento.
- Demais itens: ícone de 24px e rótulo sempre visível em `micro`. Inativo em `--ink-muted`;
  ativo com ícone e rótulo em `--primary` e uma pílula `--primary-soft` atrás do ícone, mais
  `aria-current="page"`.
- "Mais" abre uma folha com Contas, Categorias, Importações e Configurações.
- A barra some enquanto o teclado virtual está aberto.

**Barra lateral (a partir de `lg`)**

- Fixa à esquerda, 248px, sobre o próprio `--bg`, com linha direita de 1px `--border`.
- No topo, a marca "Contaí" em Besley 800 `--primary` e o botão `primary` "Novo lançamento".
- Itens com 44px de altura, ícone de 20px e rótulo em `label`: Início, Lançamentos, Contas,
  Categorias, Importações, Assistente. Ativo: fundo `--primary-soft`, texto `--primary` e uma
  barra de 3px `--primary` à esquerda.
- Na base, o nome do usuário, com acesso a Configurações e Sair.

**Cabeçalho da página**: título em `title-1` à esquerda e, no máximo, uma ação à direita. No
celular ele rola com o conteúdo; não há barra superior fixa, exceto no chat. No painel, o título
é o mês exibido e funciona como botão para escolher outro mês; as setas de mês anterior e
próximo aparecem a partir de 480px de largura.

### 6.10 Ícones

- `lucide-react`, traço de 2px, em 20px (dentro de texto e botões) ou 24px (navegação).
- Ícone sozinho só em ações universais (fechar, voltar, mostrar senha), sempre com `aria-label`.
  Nos demais casos, ícone acompanha texto.

## 7. Gráficos

Feitos com Recharts, sempre dentro de um cartão (`--surface`).

### 7.1 Regras gerais

- **A forma vem antes da cor.** Um número sozinho é um número, não um gráfico: o resumo do mês
  é `money-hero` com marca-texto, mais entradas e saídas em `money-lg`.
- **Saídas negativas não levam sinal de menos.** Em um mês com mais estornos do que gastos, as
  saídas aparecem pelo valor, seguido de "a seu favor, de estornos" em `small` `--ink-muted`:
  no resumo do mês, no resumo em texto, na dica e na tabela da evolução. No gráfico, esse mês
  fica sem barra de saídas. O cálculo não muda.
- **Texto usa tokens de texto.** Rótulos, valores, eixos e legendas ficam em `--ink`,
  `--ink-muted` ou `--ink-subtle`. A cor fica só na marca.
- **Marcas finas**: barras com no máximo 24px de espessura, ponta arredondada em 4px e base
  reta; 2px de `--surface` entre barras vizinhas; nenhuma borda desenhada em volta da marca.
- **Grade discreta**: só linhas horizontais, 1px `--chart-grid`, contínuas; eixo Y com 3 ou 4
  marcas em valores redondos e compactos ("R$ 2 mil"); eixo X sem linha.
- **Um eixo só.** Nunca dois eixos Y.
- **Legenda sempre presente** quando há duas ou mais séries, acima do gráfico, com amostra de
  cor e nome.
- **Tooltip** ao tocar ou passar o ponteiro: um pequeno cartão `--surface-raised` com
  `--elev-2`, o rótulo do período e os valores em `money-sm`.
- **Equivalente em texto**: todo gráfico tem `role="img"` com um `aria-label` que resume o que
  ele mostra, e os mesmos dados em lista ou tabela logo abaixo ou atrás de "Ver como tabela".
- Estado vazio próprio: sem dados no período, mostra a frase e a ação no lugar dos eixos.
- Cores passadas ao Recharts como `var(--token)`; nunca um hexadecimal no componente.

### 7.2 Gastos por categoria: barras ordenadas

Não se usa rosca nem pizza. A composição dos gastos é uma **lista de barras ordenadas**, da
maior para a menor, com no máximo 6 linhas (as 5 maiores e "Outras", em `--cat-ardosia`).

- Cada linha: selo da categoria, nome em `body-strong`, percentual em `small` `--ink-muted`,
  valor em `money-md` à direita e, embaixo, uma barra de 8px na cor da categoria sobre um trilho
  `--bg-sunken`, proporcional à maior categoria.
- A linha inteira é um botão que abre as transações da categoria no período.
- Categoria negativa (o estorno de uma compra de outro mês): fica no fim da lista, com o valor
  em `money-md` com `−`, sem barra e sem percentual; no lugar deles, o texto "Estornos maiores
  que os gastos do mês" em `small` `--ink-muted`.
- Funciona em 320px, cada valor é lido direto, e preenchimentos de categorias diferentes nunca
  se encostam (seção 2.3).

### 7.3 Evolução de 6 meses: barras agrupadas

- Duas séries por mês, lado a lado: Entradas (`--chart-income`) à esquerda e Saídas
  (`--chart-expense`) à direita. A posição e a legenda identificam a série, além da cor.
- Meses abreviados no eixo X ("mai", "jun"); o mês selecionado tem o rótulo em peso 700
  `--ink`.
- O tooltip mostra entradas, saídas e o saldo do mês.
- Tocar em um mês muda o período do painel para ele.

### 7.4 Parcelas futuras

Série única por mês em `--chart-single`, sem legenda: o título do cartão já diz o que é. Valor
direto só na maior barra; as demais ficam no tooltip e na tabela.

## 8. Chat do assistente

O assistente não tem visual de "IA": nada de gradiente, brilho ou avatar de robô. A conversa
parece anotações na caderneta.

- **Estrutura**: cabeçalho fixo com o título "Assistente" e o acesso ao histórico; lista de
  mensagens; campo de escrita fixo na base, acima da barra inferior. A largura da conversa é de
  no máximo 720px. A faixa do campo de escrita tem fundo `--bg` próprio, para as mensagens
  rolarem por baixo dela, e 20px de folga embaixo, para o botão de lançar não cobrir o campo.
- **Mensagem do usuário**: balão à direita, fundo `--primary`, texto `--on-primary`, raio de
  16px com o canto inferior direito em 4px, largura máxima de 85%.
- **Resposta do assistente**: sem balão, escrita direto sobre o fundo, à esquerda, precedida
  pelo rótulo "Contaí" em `label` `--ink-muted`. Texto em `body`.
- **O número da resposta**: o valor principal recebe o **marca-texto** e peso 700. Só um por
  mensagem. Os demais valores usam a classe `money`, sem destaque.
- **De onde veio o número**: logo abaixo da resposta, um bloco com o título "De onde veio esse
  número" e até 5 transações em linhas compactas, com pauta e margem, seguido de "Ver todas as
  23", que abre a lista filtrada. Vem aberto. Cada linha tem a descrição e o valor e, embaixo,
  em `micro` `--ink-muted`, o que identifica o lançamento: a categoria e a conta ou, em uma
  transferência, a conta de origem, uma seta e a conta de destino. A transferência ocupa uma
  linha só e vai sem sinal.
- **Pedido de esclarecimento**: o texto da pergunta e, abaixo, opções de resposta rápida.
- **Recusa**: uma frase educada e sugestões do que perguntar.
- **Lançamento sugerido**: cartão com valor em `money-lg`, data, conta e categoria, e os botões
  "Conferir e salvar" (`primary`, abre o formulário preenchido) e "Descartar" (`ghost`). Nada é
  salvo antes da confirmação; depois de salvo, o cartão mostra "Lançamento salvo" com o link.
- **Aguardando**: o texto "Consultando seus lançamentos…" com três pontos pulsando.
- **Chat vazio**: título em `title-2` ("Pergunte sobre o seu dinheiro") e de 4 a 6 sugestões de
  pergunta.
- **Sugestões e respostas rápidas**: contorno de 1,5px `--border-strong`, raio `--radius-sm`,
  altura mínima de 44px, texto em `label`; quebram em várias linhas em vez de rolar para o lado.
- **Campo de escrita**: área de texto que cresce de 1 a 4 linhas, texto de 16px, e botão de
  enviar de 44px em `--primary` com `aria-label="Enviar"`. No desktop, Enter envia e Shift+Enter
  quebra a linha; no celular, só o botão envia. Fica desativado enquanto aguarda a resposta.
- **Limite de uso**: com 5 perguntas ou menos, aparece "Restam 3 perguntas hoje" acima do campo.
  No limite, o campo dá lugar a um aviso em `--warning-soft` com o horário em que volta.
- **Erro ou indisponibilidade**: nota na própria conversa, com ícone e "Tentar de novo".
- **Acessibilidade**: a lista de mensagens é uma região `aria-live="polite"`; a resposta nova é
  anunciada inteira, não palavra por palavra.

## 9. Animação

O movimento existe para explicar de onde algo veio e para onde foi. Fora isso, a tela fica
parada.

### 9.1 Tokens

| Token | Valor | Uso |
|-------|-------|-----|
| `--duration-instant` | 80ms | pressionar botão |
| `--duration-fast` | 140ms | hover, cor, saídas |
| `--duration-base` | 220ms | entradas, toasts, mensagens |
| `--duration-slow` | 360ms | folhas, barras de gráfico |
| `--duration-emphasis` | 520ms | o traço de marca-texto |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | tudo que entra |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | tudo que sai |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | o que se move na tela |

No Motion, folhas e diálogos usam mola sem ricochete:
`{ type: "spring", visualDuration: 0.36, bounce: 0 }`. Os mesmos valores ficam em
`src/lib/motion.ts`, que é a única fonte para os componentes.

### 9.2 O que anima

| Momento | Movimento | Duração e curva |
|---------|-----------|-----------------|
| **Entrada do painel** (o momento orquestrado) | cartões sobem 8px com opacidade, em cascata de 60ms, no máximo 6 itens; depois o marca-texto é pintado da esquerda para a direita atrás do número principal | `base` com `ease-out` por cartão; `emphasis` com `ease-out` no traço; total abaixo de 900ms |
| Troca de rota | opacidade e 4px na vertical | `fast` para sair, `base` para entrar |
| Folha e diálogo | a folha sobe da base; o diálogo vai de escala 0,97 a 1 com opacidade; o véu só muda a opacidade | mola de 360ms para entrar; `fast` com `ease-in` para sair |
| Item novo ou removido de lista | altura e opacidade | `base` para entrar, `fast` para sair |
| Toast | 12px na vertical e opacidade | `base` para entrar, `fast` para sair |
| Mensagem do chat | 6px na vertical e opacidade | `base` com `ease-out` |
| Barras de gráfico | crescem da base, uma vez, em cascata de 30ms | `slow` com `ease-out` |
| Botão pressionado, caixa marcada | escala 0,98; traço da marca desenhado | `instant`; `fast` |
| Esqueleto e pontos de "aguardando" | pulso de opacidade | ciclo de 1,6s |

Hover, foco, cor e pressionar usam transições de CSS. O Motion entra só onde o CSS não chega:
entrada e saída de elementos (`AnimatePresence`), mudança de layout e cascatas.

### 9.3 O que nunca anima

- Valores em reais: não há contagem, giro de algarismos nem troca gradual. O número aparece
  pronto.
- Nada com ricochete, nada acima de 600ms além do traço de marca-texto, nada em laço além dos
  indicadores de espera.
- Nada disparado por rolagem, e nenhum efeito de paralaxe.
- Listas com mais de 50 itens não animam entrada nem reordenação.
- Só `transform` e `opacity` (e altura, pelo Motion, em itens de lista). Nunca largura, margem
  ou sombra.
- A animação nunca bloqueia a interação: o conteúdo já está utilizável enquanto ela acontece.

### 9.4 Movimento reduzido

Com `prefers-reduced-motion: reduce`:

- `<MotionConfig reducedMotion="user">` na raiz do app: o Motion deixa de animar posição, escala
  e layout e mantém só a opacidade.
- Uma regra global de CSS reduz transições e animações a 0,01ms e desliga os laços.
- O marca-texto e as barras dos gráficos aparecem prontos (`isAnimationActive={false}` no
  Recharts).
- Os pontos de "aguardando" e o esqueleto ficam parados; o texto "Consultando seus
  lançamentos…" continua.
- Nenhuma informação depende de animação para ser entendida.

## 10. Implementação: `globals.css` e Tailwind 4

Os tokens vivem em um só lugar, `frontend/src/styles/globals.css`, em três camadas:

1. **Valores por tema**, como propriedades CSS em `:root` (claro) e em
   `:root[data-theme="dark"]` (escuro).
2. **Ponte para o Tailwind**, em `@theme inline`, que cria as classes utilitárias apontando para
   as propriedades da camada 1. O `inline` faz a classe usar `var(--token)` diretamente, e é
   isso que permite trocar o tema sem recompilar.
3. **Tokens fixos** (fontes, tamanhos, raios, curvas), direto em `@theme`.

```css
@import "tailwindcss";

/* dark: passa a obedecer ao atributo, e não só à preferência do sistema */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@font-face {
  font-family: "Atkinson Hyperlegible Next";
  src: url("../assets/fonts/AtkinsonHyperlegibleNext-Variable.woff2") format("woff2");
  font-weight: 200 800;
  font-display: swap;
}
@font-face {
  font-family: "Besley";
  src: url("../assets/fonts/Besley-Variable.woff2") format("woff2");
  font-weight: 400 900;
  font-display: swap;
}

/* 1. Valores por tema */
:root {
  color-scheme: light;
  --bg: #f5f0e6;
  --surface: #fffdf8;
  --ink: #1a2238;
  --primary: #2a3fb0;
  --highlight: #ffe066;
  --income: #136f58;
  --cat-caqui: #d9621e;
  --elev-2: 0 6px 16px -4px rgb(26 34 56 / 0.14);
  /* ...todos os tokens das seções 2 e 5 */
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #10152a;
  --surface: #182040;
  --ink: #efe9dc;
  --primary: #9daeff;
  --highlight: #5e4b00;
  --income: #6fd3b0;
  --cat-caqui: #dd7435;
  --elev-2: 0 6px 16px -4px rgb(0 0 0 / 0.5);
  /* ... */
}

/* 2. Ponte para o Tailwind */
@theme inline {
  --color-*: initial; /* desativa a paleta padrão do Tailwind */
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-primary: var(--primary);
  --color-highlight: var(--highlight);
  --color-income: var(--income);
  --color-cat-caqui: var(--cat-caqui);
  --shadow-md: var(--elev-2);
  /* ... */
}

/* 3. Tokens fixos */
@theme {
  --font-sans: "Atkinson Hyperlegible Next", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Besley", ui-serif, Georgia, serif;

  --text-body: 1rem;
  --text-body--line-height: 1.5rem;
  --text-title-1: 1.5rem;
  --text-title-1--line-height: 1.875rem;
  --text-money-hero: 2.5rem;
  --text-money-hero--line-height: 2.75rem;

  --radius-sm: 0.375rem;
  --radius-md: 0.625rem;
  --radius-lg: 1rem;
  --radius-xl: 1.5rem;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
}

/* Utilitários próprios */
@utility money {
  font-variant-numeric: tabular-nums lining-nums;
  white-space: nowrap;
}
/* O traço é um pseudo-elemento, para poder ser pintado só com transform (seção 9). */
@utility marca-texto {
  position: relative;
  isolation: isolate;
  white-space: nowrap;
  &::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: 46% -0.15em 6% -0.15em;
    background: var(--highlight);
    border-radius: 2px;
    transform-origin: left center;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

O bloco acima mostra a estrutura e alguns tokens de exemplo; o arquivo real declara todos os
tokens deste documento.

Regras de uso:

- Com isso existem classes como `bg-surface`, `text-ink`, `text-ink-muted`, `border-border`,
  `bg-cat-caqui`, `font-display`, `text-title-1`, `rounded-lg`, `shadow-md`, `money` e
  `marca-texto`.
- Como `--color-*: initial` desativa a paleta padrão, classes como `bg-blue-500` ou
  `text-gray-600` deixam de existir. Componentes só usam os tokens deste documento.
- É proibido valor arbitrário de cor (`bg-[#2a3fb0]`) e `style` com cor fixa. Precisou de uma
  cor nova: ela entra aqui primeiro, com o contraste conferido.
- **Tema**: o atributo `data-theme` fica no `<html>`. Um script pequeno e externo
  (`theme-init.js`, na própria origem, para respeitar a política de segurança de conteúdo) roda
  antes da primeira pintura e define o atributo a partir da escolha salva no navegador ou, se
  não houver, da preferência do sistema. A troca manual fica em Configurações, com as opções
  Claro, Escuro e Automático.
- A variante `dark:` do Tailwind raramente é necessária, porque os tokens já mudam com o tema.
  Fica para os poucos casos em que o desenho, e não só a cor, muda.
- Recharts e Motion leem os mesmos tokens: cores como `var(--chart-income)`; durações e curvas
  de `src/lib/motion.ts`, que espelha a seção 9.1.

## 11. Conferência antes de entregar uma tela

- [ ] Funciona em 320px de largura, sem rolagem horizontal.
- [ ] Funciona nos temas claro e escuro, só com tokens.
- [ ] Texto com contraste de 4,5:1 ou mais; controles e marcas de gráfico com 3:1 ou mais.
- [ ] Navegável só com o teclado, com foco sempre visível e em ordem lógica.
- [ ] Todo campo tem rótulo; todo botão de ícone tem `aria-label`.
- [ ] Alvos de toque com 44px ou mais.
- [ ] Nenhuma informação depende só de cor.
- [ ] Estados de carregamento, erro e vazio existem, e o erro diz o que fazer.
- [ ] Ação destrutiva pede confirmação.
- [ ] Valores em reais usam a classe `money` e o formato `R$ 1.234,56`.
- [ ] No máximo um marca-texto e uma ação `primary` na tela.
- [ ] Com movimento reduzido, a tela funciona e nada se desloca.
- [ ] Textos em português do Brasil, simples e sem jargão.
