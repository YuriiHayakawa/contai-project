import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "../../../components/ui/Button";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage, fieldErrors } from "../../../lib/api-client";
import { useChangePassword } from "../hooks/useProfile";

import { SettingsSection } from "./SettingsSection";

const schema = z.object({
  current_password: z.string().min(1, "Informe sua senha atual."),
  new_password: z.string().min(8, "Use uma senha com pelo menos 8 caracteres."),
});

type FormValues = z.infer<typeof schema>;

/** Troca de senha: exige a senha atual e, ao concluir, encerra as outras sessões (FR-015). */
export function PasswordSection() {
  const change = useChangePassword();
  const toast = useToast();
  const {
    register: field,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: "", new_password: "" },
  });

  const submit = handleSubmit((values) => {
    change.mutate(values, {
      onSuccess: () => {
        toast.success("Senha alterada. As outras sessões foram encerradas.");
        reset();
      },
      onError: (error) => {
        // Mensagens por campo vindas do servidor (senha atual errada, senha nova fraca).
        for (const [name, message] of Object.entries(fieldErrors(error))) {
          if (name === "current_password" || name === "new_password") {
            setError(name, { message });
          }
        }
      },
    });
  });

  // Erro geral (sem campo): mostra o aviso no topo.
  const generalError = change.isError && Object.keys(fieldErrors(change.error)).length === 0;

  return (
    <SettingsSection title="Senha">
      <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
        {generalError && <Notice kind="error">{errorMessage(change.error)}</Notice>}
        <TextField
          label="Senha atual"
          type="password"
          autoComplete="current-password"
          error={errors.current_password?.message}
          {...field("current_password")}
        />
        <TextField
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          help="Pelo menos 8 caracteres. Uma frase fácil de lembrar funciona bem."
          error={errors.new_password?.message}
          {...field("new_password")}
        />
        <div className="justify-self-start">
          <Button type="submit" loading={change.isPending}>
            Trocar a senha
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
