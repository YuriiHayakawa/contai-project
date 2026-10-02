// Conjunto de ícones de categoria. O banco guarda o nome (a chave deste mapa); o desenho vem
// do lucide-react. Um nome desconhecido cai no ícone neutro, para a tela nunca quebrar.
import {
  Baby,
  Banknote,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Coffee,
  CreditCard,
  Dumbbell,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  Lightbulb,
  Music,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Repeat,
  Scissors,
  Shapes,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Stethoscope,
  Ticket,
  TrendingUp,
  Tv,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

export const CATEGORY_ICONS = {
  // alimentação
  utensils: Utensils,
  "shopping-cart": ShoppingCart,
  coffee: Coffee,
  // transporte
  car: Car,
  bus: Bus,
  fuel: Fuel,
  plane: Plane,
  // moradia e contas da casa
  house: House,
  lightbulb: Lightbulb,
  zap: Zap,
  wifi: Wifi,
  wrench: Wrench,
  // saúde
  "heart-pulse": HeartPulse,
  stethoscope: Stethoscope,
  pill: Pill,
  dumbbell: Dumbbell,
  // educação
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  // lazer
  ticket: Ticket,
  film: Film,
  music: Music,
  "gamepad-2": Gamepad2,
  // assinaturas e serviços
  repeat: Repeat,
  tv: Tv,
  smartphone: Smartphone,
  // compras e cuidados pessoais
  "shopping-bag": ShoppingBag,
  shirt: Shirt,
  scissors: Scissors,
  gift: Gift,
  // família
  baby: Baby,
  "paw-print": PawPrint,
  // dinheiro: receitas, bancos e impostos
  banknote: Banknote,
  briefcase: Briefcase,
  "hand-coins": HandCoins,
  "trending-up": TrendingUp,
  "piggy-bank": PiggyBank,
  landmark: Landmark,
  "credit-card": CreditCard,
  receipt: Receipt,
  // neutro: categoria "Outros"
  shapes: Shapes,
} as const satisfies Record<string, LucideIcon>;

export type CategoryIconName = keyof typeof CATEGORY_ICONS;

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS) as CategoryIconName[];

export const FALLBACK_CATEGORY_ICON: CategoryIconName = "shapes";

export function isCategoryIconName(name: string): name is CategoryIconName {
  return Object.hasOwn(CATEGORY_ICONS, name);
}

/** Nome válido do ícone de uma categoria, a partir do que está guardado no banco. */
export function resolveCategoryIconName(name: string): CategoryIconName {
  return isCategoryIconName(name) ? name : FALLBACK_CATEGORY_ICON;
}
