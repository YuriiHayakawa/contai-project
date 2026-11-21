import { useLocalSearchParams } from "expo-router";

import { EditTransactionScreen } from "@/features/transactions/components/TransactionScreens";

export default function TransactionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditTransactionScreen id={id} />;
}
