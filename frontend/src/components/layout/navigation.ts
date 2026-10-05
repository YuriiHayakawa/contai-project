import {
  CreditCard,
  House,
  List,
  MessageCircle,
  Settings,
  Tag,
  Upload,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { paths } from "../../lib/paths";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Só o endereço exato marca o item como ativo; é o caso de "Início" (`/`). */
  end?: boolean;
}

const home: NavItem = { label: "Início", to: paths.home, icon: House, end: true };
const transactions: NavItem = { label: "Lançamentos", to: paths.transactions, icon: List };
const accounts: NavItem = { label: "Contas", to: paths.accounts, icon: Wallet };
const cards: NavItem = { label: "Cartões", to: paths.cards, icon: CreditCard };
const categories: NavItem = { label: "Categorias", to: paths.categories, icon: Tag };
const imports: NavItem = { label: "Importações", to: paths.imports, icon: Upload };
const assistant: NavItem = { label: "Assistente", to: paths.assistant, icon: MessageCircle };
export const settingsItem: NavItem = { label: "Configurações", to: paths.settings, icon: Settings };

export interface NavOptions {
  /** Quem tem cartão de crédito ativo vê o item "Cartões", logo depois de "Contas". */
  hasCards: boolean;
}

/** Barra lateral, a partir de `lg`. */
export function sidebarItems({ hasCards }: NavOptions): readonly NavItem[] {
  return [
    home,
    transactions,
    accounts,
    ...(hasCards ? [cards] : []),
    categories,
    imports,
    assistant,
  ];
}

/** Barra inferior: dois itens de cada lado do botão "Lançar"; o último lugar é o "Mais". */
export const bottomNavLeading: readonly NavItem[] = [home, transactions];
export const bottomNavTrailing: readonly NavItem[] = [assistant];

/** Folha "Mais" da barra inferior. */
export function moreItems({ hasCards }: NavOptions): readonly NavItem[] {
  return [accounts, ...(hasCards ? [cards] : []), categories, imports, settingsItem];
}
