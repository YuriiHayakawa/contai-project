import {
  Banknote,
  CreditCard,
  Landmark,
  PiggyBank,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import type { AccountType } from "./types";

/** Desenho de cada tipo de conta, igual em todas as telas que listam contas. */
export const ACCOUNT_TYPE_ICONS: Record<AccountType, LucideIcon> = {
  checking: Landmark,
  credit_card: CreditCard,
  cash: Banknote,
  savings: PiggyBank,
  investment: TrendingUp,
};
