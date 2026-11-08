// Texto da política de privacidade (FR-002). A versão aceita no cadastro fica gravada na conta:
// ao mudar o texto, mude também `PRIVACY_POLICY_VERSION` aqui e em
// backend/app/modules/auth/service.py. O texto final é conferido na T220, com os termos atuais
// do provedor de IA.

export const PRIVACY_POLICY_VERSION = "3";
/** Data da versão, como dia de calendário (`YYYY-MM-DD`). */
export const PRIVACY_POLICY_UPDATED_ON = "2026-11-08";

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
      "Algumas funções do Contaí usam o plano gratuito de um serviço de inteligência artificial (IA) de outra empresa. Enviamos a ele só o necessário para cada tarefa:",
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
      "Como o Contaí usa o plano gratuito desse serviço, a empresa que o fornece pode usar os dados que recebe para melhorar os próprios modelos. Isso vale para tudo o que é enviado a ela, conforme a lista acima.",
      "Se você não quiser que um documento seja usado assim, não envie PDFs nem imagens: você pode lançar os valores à mão ou importar arquivos OFX, CSV e planilhas, que não passam pela IA.",
    ],
  },
  {
    title: "Cópias de segurança",
    paragraphs: [
      "Por enquanto, a única cópia de segurança é um histórico que o próprio serviço do banco de dados guarda. Com ele, dá para voltar o banco a um momento das últimas horas (no máximo 6), se algo der errado. O que passa desse prazo sai do histórico sozinho.",
      "Cópias diárias, cifradas e guardadas por 14 dias, estão em implantação. Quando elas começarem, esta política será atualizada.",
      "Por isso, depois que uma conta é excluída de vez, os dados dela ainda podem existir nesse histórico por até 6 horas. Passado esse prazo, não existem mais em lugar nenhum.",
      'Se quiser ter uma cópia sua, baixe seus dados a qualquer hora em Configurações, no botão "Baixar meus dados".',
    ],
  },
  {
    title: "Onde os dados ficam",
    paragraphs: [
      "Seus dados ficam fora do Brasil: o servidor e o banco de dados do Contaí ficam nos Estados Unidos, e o serviço de IA também é de uma empresa de fora do país. A Lei Geral de Proteção de Dados (LGPD) chama isso de transferência internacional de dados.",
      "Os dados sempre viajam por conexões cifradas, entre o seu aparelho e esses serviços e entre um serviço e outro.",
      "O Contaí funciona sobre serviços de outras empresas. Cada uma recebe só o que precisa para a sua parte:",
    ],
    items: [
      "Vercel: entrega as páginas do app e repassa os seus pedidos ao servidor do Contaí;",
      "Render: roda o servidor do Contaí, que lê e grava os seus dados;",
      "Neon: guarda o banco de dados, com todos os dados listados no começo desta política, e o histórico de poucas horas que serve de cópia de segurança;",
      "Brevo: entrega os e-mails do Contaí, como o de confirmação da conta e o de nova senha. Para isso, recebe seu nome, seu e-mail e o texto de cada mensagem.",
    ],
  },
];
