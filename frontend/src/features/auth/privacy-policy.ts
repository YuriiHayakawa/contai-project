// Texto da política de privacidade (FR-002). A versão aceita no cadastro fica gravada na conta:
// ao mudar o texto, mude também `PRIVACY_POLICY_VERSION` aqui e em
// backend/app/modules/auth/service.py. O texto final é conferido na T220, com os termos atuais
// do provedor de IA.

export const PRIVACY_POLICY_VERSION = "1";
/** Data da versão, como dia de calendário (`YYYY-MM-DD`). */
export const PRIVACY_POLICY_UPDATED_ON = "2026-10-01";

export interface PolicySection {
  title: string;
  paragraphs: readonly string[];
  /** Lista de itens mostrada depois dos parágrafos. */
  items?: readonly string[];
}

export const PRIVACY_POLICY_SECTIONS: readonly PolicySection[] = [
  {
    title: "Quais dados o Contaí guarda",
    paragraphs: ["O Contaí guarda só o que você informa para usar o app:"],
    items: [
      "seu nome e seu e-mail;",
      "sua senha, de forma embaralhada: nem nós conseguimos lê-la;",
      "suas contas, categorias e lançamentos;",
      "os arquivos que você envia para importar, só até serem lidos;",
      "suas conversas com o assistente.",
    ],
  },
  {
    title: "Como seus dados são tratados",
    paragraphs: [
      "Cada pessoa vê apenas os próprios dados. Ninguém que usa o Contaí consegue ver contas, lançamentos, arquivos ou conversas de outra pessoa.",
      "Os arquivos que você envia para importar são apagados depois de lidos. Os registros técnicos do sistema não guardam senhas, valores nem descrições dos seus lançamentos.",
      "Você pode baixar todos os seus dados e excluir a sua conta quando quiser. Ao pedir a exclusão, a conta é desativada na hora e você tem 7 dias para desistir; depois disso, seus dados, arquivos e conversas são apagados de vez.",
    ],
  },
  {
    title: "O que é enviado ao serviço de inteligência artificial",
    paragraphs: [
      "Algumas funções do Contaí usam um serviço de inteligência artificial (IA) de outra empresa. Enviamos a ele só o necessário para cada tarefa:",
    ],
    items: [
      "quando você faz uma pergunta ao assistente: a pergunta e os dados necessários para respondê-la, como totais e lançamentos do período perguntado;",
      "quando o Contaí sugere uma categoria: apenas a descrição do lançamento;",
      "quando você envia um PDF ou uma imagem de extrato, fatura ou comprovante: o conteúdo desse arquivo. Antes do primeiro envio, o Contaí avisa e só continua se você aceitar.",
    ],
  },
  {
    title: "O que nunca é enviado à IA",
    paragraphs: [
      "Sua senha, seus dados de acesso e o seu histórico completo nunca são enviados ao serviço de IA.",
      "Extratos em OFX, CSV e planilhas são lidos pelo próprio Contaí, sem IA. Deles, só as descrições dos lançamentos podem ser enviadas, para sugerir a categoria.",
    ],
  },
  {
    title: "Como o serviço de IA pode usar esses dados",
    paragraphs: [
      "A empresa que fornece o serviço de IA pode usar os dados que recebe para melhorar os próprios modelos. Isso vale para tudo o que é enviado a ela, conforme a lista acima.",
      "Se você não quiser que um documento seja usado assim, não envie PDFs nem imagens: você pode lançar os valores à mão ou importar arquivos OFX, CSV e planilhas, que não passam pela IA.",
    ],
  },
  {
    title: "Cópias de segurança",
    paragraphs: [
      "Todos os dias o Contaí faz uma cópia de segurança dos dados, para poder recuperá-los se algo der errado. Cada cópia é guardada por 14 dias e depois é apagada.",
      "Por isso, depois que uma conta é excluída de vez, os dados dela ainda podem existir nas cópias de segurança por até 14 dias. Passado esse prazo, não existem mais em lugar nenhum.",
    ],
  },
];
