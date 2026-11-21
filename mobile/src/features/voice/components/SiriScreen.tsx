import { dateTimeLabel } from "@web/lib/dates";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Notice } from "@/components/ui/Notice";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api-client";
import { radius, space } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import { activeAccounts, useAccounts } from "../../accounts/hooks/useAccounts";
import {
  usePersonalTokens,
  useRevokePersonalToken,
  useUpdateDefaultAccount,
} from "../hooks/usePersonalTokens";
import { MAX_ACTIVE_TOKENS, type PersonalToken } from "../types";

const PASSWORD_NOTICE =
  "Trocar a senha desconecta a Siri. Depois de trocar, gere um token novo e cole no atalho.";

interface TokenCardProps {
  token: PersonalToken;
  accountChoices: { value: string; label: string }[];
  onRevoke: (token: PersonalToken) => void;
}

function TokenCard({ token, accountChoices, onRevoke }: TokenCardProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const update = useUpdateDefaultAccount();
  const lastUse = token.last_used_at
    ? `Última frase: ${dateTimeLabel(token.last_used_at)}`
    : "Ainda sem frases";

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="title3">{token.name}</Text>
      <Text variant="small" color="inkMuted">
        {lastUse}
      </Text>
      {token.needs_default_account && (
        <Notice kind="warning">
          Escolha uma conta padrão: sem ela, as frases que não dizem a conta não são lançadas.
        </Notice>
      )}
      <OptionPicker
        label="Conta padrão"
        placeholder="Sem conta padrão"
        value={token.needs_default_account ? "" : (token.default_account?.id ?? "")}
        options={accountChoices}
        onChange={(accountId) =>
          update.mutate(
            { id: token.id, accountId },
            { onSuccess: () => toast.show({ message: "Conta padrão trocada.", kind: "success" }) },
          )
        }
      />
      {update.isError && <Notice kind="error">{errorMessage(update.error)}</Notice>}
      <Button
        compact
        variant="ghost"
        label={`Desconectar ${token.name}`}
        onPress={() => onRevoke(token)}
      />
    </View>
  );
}

/** "Conectar à Siri": os tokens ativos, a conta padrão de cada um e a revogação (US3). */
export function SiriScreen() {
  const router = useRouter();
  const toast = useToast();
  const tokens = usePersonalTokens();
  const accounts = useAccounts();
  const revoke = useRevokePersonalToken();
  const [revoking, setRevoking] = useState<PersonalToken | null>(null);

  const accountChoices = activeAccounts(accounts.data ?? []).map((account) => ({
    value: account.id,
    label: account.name,
  }));
  const items = tokens.data ?? [];
  const atLimit = items.length >= MAX_ACTIVE_TOKENS;

  let content;
  if (tokens.isPending || accounts.isPending) {
    content = <LoadingState message="Carregando os atalhos conectados…" />;
  } else if (tokens.error ?? accounts.error) {
    content = (
      <ErrorState
        message={errorMessage(tokens.error ?? accounts.error)}
        onRetry={() => {
          void tokens.refetch();
          void accounts.refetch();
        }}
      />
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        title="A Siri ainda não está conectada"
        description='Gere um token e monte o atalho: depois é só dizer "E aí Siri, Contaí" e o gasto.'
        actionLabel="Conectar a Siri"
        onAction={() => router.push("/siri/novo-token")}
      />
    );
  } else {
    content = (
      <>
        {items.map((token) => (
          <TokenCard
            key={token.id}
            token={token}
            accountChoices={accountChoices}
            onRevoke={setRevoking}
          />
        ))}
        {atLimit ? (
          <Notice kind="info">
            {`Você já tem ${MAX_ACTIVE_TOKENS} atalhos conectados. Desconecte um para gerar outro.`}
          </Notice>
        ) : (
          <Button
            variant="secondary"
            label="Gerar outro token"
            onPress={() => router.push("/siri/novo-token")}
          />
        )}
      </>
    );
  }

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <Text variant="body" color="inkMuted">
        Com a Siri, você lança um gasto sem abrir o app. O token só serve para isso: ele não vê
        saldos nem outros lançamentos.
      </Text>
      {content}
      <Notice kind="info">{PASSWORD_NOTICE}</Notice>
      <ConfirmDialog
        open={revoking !== null}
        title="Desconectar a Siri deste token?"
        description="O atalho que usa este token para de lançar na hora. Para voltar, gere um token novo."
        confirmLabel="Desconectar"
        loading={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          if (!revoking) return;
          revoke.mutate(revoking.id, {
            onSuccess: () => toast.show({ message: "Siri desconectada.", kind: "success" }),
            onSettled: () => setRevoking(null),
          });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space[4], gap: space[3] },
});
