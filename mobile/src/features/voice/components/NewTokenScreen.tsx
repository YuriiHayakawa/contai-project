import { paths } from "@web/lib/paths";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Notice } from "@/components/ui/Notice";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { errorMessage, fieldErrors, isApiError } from "@/lib/api-client";
import { openSite } from "@/lib/site";
import { space } from "@/theme/tokens";

import { activeAccounts, useAccounts } from "../../accounts/hooks/useAccounts";
import { useMostUsedAccount } from "../../transactions/hooks/useMostUsedAccount";
import { useCreatePersonalToken } from "../hooks/usePersonalTokens";
import { NewTokenResult } from "./NewTokenResult";

const NAME_REQUIRED = "Dê um nome ao token, como o do aparelho.";
const ACCOUNT_REQUIRED = "Escolha a conta das frases que não dizem a conta.";

/** Gerar um token: o nome e a conta padrão; depois, o token uma única vez e o passo a passo. */
export function NewTokenScreen() {
  const router = useRouter();
  const accounts = useAccounts();
  const mostUsed = useMostUsedAccount(accounts.data);
  const create = useCreatePersonalToken();
  const [name, setName] = useState("iPhone");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const chosenAccount = accountId ?? mostUsed ?? "";

  if (create.data) {
    return (
      <Screen edges={["left", "right", "bottom"]}>
        <NewTokenResult token={create.data.token} onDone={() => router.back()} />
      </Screen>
    );
  }
  if (accounts.isPending) {
    return (
      <Screen edges={["left", "right", "bottom"]}>
        <LoadingState />
      </Screen>
    );
  }
  if (accounts.error || !accounts.data) {
    return (
      <Screen edges={["left", "right", "bottom"]}>
        <ErrorState
          message={errorMessage(accounts.error)}
          onRetry={() => void accounts.refetch()}
        />
      </Screen>
    );
  }
  const choices = activeAccounts(accounts.data).map((account) => ({
    value: account.id,
    label: account.name,
  }));
  if (choices.length === 0) {
    return (
      <Screen edges={["left", "right", "bottom"]}>
        <EmptyState
          title="Cadastre uma conta primeiro"
          description="A Siri lança numa conta sua. As contas são cadastradas pelo site."
          actionLabel="Cadastrar conta no site"
          onAction={() => void openSite(paths.accounts)}
        />
      </Screen>
    );
  }

  const serverFields = fieldErrors(create.error);
  const nameError = submitted && !name.trim() ? NAME_REQUIRED : serverFields.name;
  const accountError =
    submitted && !chosenAccount ? ACCOUNT_REQUIRED : serverFields.default_account_id;
  const limitReached = isApiError(create.error) && create.error.code === "personal_token_limit";

  const submit = (): void => {
    setSubmitted(true);
    if (!name.trim() || !chosenAccount) return;
    create.mutate({ name: name.trim(), default_account_id: chosenAccount });
  };

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <View style={styles.form}>
        <TextField
          label="Nome do token"
          help="Para você reconhecer depois, como o nome do aparelho."
          value={name}
          onChangeText={setName}
          maxLength={60}
          error={nameError}
        />
        <OptionPicker
          label="Conta padrão"
          value={chosenAccount}
          options={choices}
          onChange={setAccountId}
          error={accountError}
        />
        {create.isError && !nameError && !accountError && (
          <Notice kind={limitReached ? "warning" : "error"}>{errorMessage(create.error)}</Notice>
        )}
        <Button label="Gerar token" loading={create.isPending} onPress={submit} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[6] },
});
