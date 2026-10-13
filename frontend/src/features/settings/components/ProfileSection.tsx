import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "../../../components/ui/Button";
import { Notice } from "../../../components/ui/Notice";
import { TextField } from "../../../components/ui/TextField";
import { errorMessage } from "../../../lib/api-client";
import { useToast } from "../../../components/ui/Toast";
import type { CurrentUser } from "../../auth/types";
import { useUpdateProfile } from "../hooks/useProfile";
import { SettingsSection } from "./SettingsSection";

const schema = z.object({
  name: z.string().trim().min(1, "Informe seu nome.").max(100, "Use no máximo 100 caracteres."),
});

type FormValues = z.infer<typeof schema>;

export interface ProfileSectionProps {
  user: CurrentUser;
}

/** Nome e e-mail da conta. O e-mail não muda aqui; só o nome. */
export function ProfileSection({ user }: ProfileSectionProps) {
  const update = useUpdateProfile();
  const toast = useToast();
  const {
    register: field,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: user.name } });

  const submit = handleSubmit((values) => {
    update.mutate(
      { name: values.name },
      { onSuccess: () => toast.success("Nome atualizado.") },
    );
  });

  return (
    <SettingsSection title="Perfil">
      <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
        {update.isError && <Notice kind="error">{errorMessage(update.error)}</Notice>}
        <TextField label="Nome" autoComplete="name" error={errors.name?.message} {...field("name")} />
        <TextField label="E-mail" value={user.email} readOnly disabled help="O e-mail não pode ser alterado." />
        <div className="justify-self-start">
          <Button type="submit" loading={update.isPending} disabled={!isDirty}>
            Salvar
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
