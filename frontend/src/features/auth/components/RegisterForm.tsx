import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Button } from "../../../components/ui/Button";
import { Checkbox } from "../../../components/ui/Checkbox";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { TextLink } from "../../../components/ui/TextLink";
import { errorMessage, fieldErrors } from "../../../lib/api-client";
import { paths } from "../../../lib/paths";
import { useRegister } from "../hooks/useRegister";
import { registerSchema, type RegisterFormValues } from "../schemas";

export interface RegisterFormProps {
  /** Chamado quando o cadastro é aceito, com o e-mail informado. */
  onRegistered: (email: string) => void;
}

// Campo da API → campo do formulário, para a mensagem do servidor aparecer junto do campo.
const API_FIELDS: Record<string, keyof RegisterFormValues> = {
  name: "name",
  email: "email",
  password: "password",
  accept_privacy_policy: "acceptPrivacyPolicy",
};

/** Formulário de cadastro: nome, e-mail, senha e o aceite da política de privacidade. */
export function RegisterForm({ onRegistered }: RegisterFormProps) {
  const registration = useRegister();
  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", acceptPrivacyPolicy: false },
  });

  const serverFieldErrors = fieldErrors(registration.error);
  const hasServerFieldError = Object.keys(serverFieldErrors).some((name) => name in API_FIELDS);

  const submit = handleSubmit((values) => {
    registration.mutate(
      {
        name: values.name,
        email: values.email,
        password: values.password,
        accept_privacy_policy: values.acceptPrivacyPolicy,
      },
      {
        onSuccess: () => onRegistered(values.email),
        onError: (error) => {
          for (const [apiField, message] of Object.entries(fieldErrors(error))) {
            const formField = API_FIELDS[apiField];
            if (formField) setError(formField, { message }, { shouldFocus: true });
          }
        },
      },
    );
  });

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
      {registration.isError && !hasServerFieldError && (
        <Notice kind="error">{errorMessage(registration.error)}</Notice>
      )}
      <TextField label="Nome" autoComplete="name" error={errors.name?.message} {...field("name")} />
      <TextField
        label="E-mail"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        error={errors.email?.message}
        {...field("email")}
      />
      <TextField
        label="Senha"
        type="password"
        autoComplete="new-password"
        help="Pelo menos 8 caracteres. Uma frase que só você conheça funciona bem."
        error={errors.password?.message}
        {...field("password")}
      />
      <Checkbox error={errors.acceptPrivacyPolicy?.message} {...field("acceptPrivacyPolicy")}>
        Li e aceito a{" "}
        <TextLink to={paths.privacy} target="_blank" rel="noopener">
          política de privacidade
        </TextLink>
        .
      </Checkbox>
      <Button type="submit" block loading={registration.isPending}>
        Criar conta
      </Button>
    </form>
  );
}
