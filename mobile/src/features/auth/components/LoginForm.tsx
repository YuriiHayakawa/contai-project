import { zodResolver } from "@hookform/resolvers/zod";
import { type LoginFormValues, loginSchema } from "@web/features/auth/schemas";
import { Controller, useForm } from "react-hook-form";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { errorMessage, isApiError } from "@/lib/api-client";
import { space } from "@/theme/tokens";

import { useLogin } from "../hooks/useLogin";

export interface LoginFormProps {
  /** A senha conferiu e falta a segunda etapa: a tela leva ao código. */
  onTwoFactor: () => void;
}

/** Entrada com e-mail e senha, com o mesmo schema do site. Sem duas etapas, o guard leva adiante. */
export function LoginForm({ onTwoFactor }: LoginFormProps) {
  const login = useLogin();
  const { control, handleSubmit } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const warning =
    isApiError(login.error) &&
    (login.error.code === "email_not_verified" || login.error.code === "account_locked");

  const submit = handleSubmit((values) => {
    login.mutate(
      { email: values.email, password: values.password },
      {
        onSuccess: ({ twoFactorRequired }) => {
          if (twoFactorRequired) onTwoFactor();
        },
      },
    );
  });

  return (
    <View style={styles.form}>
      {login.isError && (
        <Notice kind={warning ? "warning" : "error"}>{errorMessage(login.error)}</Notice>
      )}
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <TextField
            label="E-mail"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="username"
            returnKeyType="next"
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <TextField
            label="Senha"
            password
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
        )}
      />
      <Button label="Entrar" loading={login.isPending} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[4] },
});
