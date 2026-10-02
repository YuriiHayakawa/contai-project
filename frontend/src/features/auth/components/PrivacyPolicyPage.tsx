import { Link } from "react-router";

import { Card } from "../../../components/ui/Card";
import { TextLink } from "../../../components/ui/TextLink";
import { paths } from "../../../lib/paths";
import {
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_UPDATED_ON,
  PRIVACY_POLICY_VERSION,
} from "../privacy-policy";

const updatedOn = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(
  new Date(`${PRIVACY_POLICY_UPDATED_ON}T12:00:00Z`),
);

/** Política de privacidade: rota pública, lida antes de criar a conta (FR-002). */
export function PrivacyPolicyPage() {
  return (
    <main className="mx-auto grid w-full max-w-180 gap-5 px-4 py-8 sm:px-6">
      <Link
        to={paths.login}
        className="justify-self-start rounded-sm font-display text-display font-extrabold text-primary"
      >
        Contaí
      </Link>
      <header className="grid gap-1">
        <h1 className="font-display text-title-1 text-ink">Política de privacidade</h1>
        <p className="text-small text-ink-muted">
          Versão {PRIVACY_POLICY_VERSION}, de {updatedOn}.
        </p>
      </header>

      {PRIVACY_POLICY_SECTIONS.map((section) => (
        <Card key={section.title}>
          <div className="grid max-w-[65ch] gap-3 text-body text-ink">
            <h2 className="font-display text-title-2">{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.items && (
              <ul className="grid list-disc gap-2 pl-5">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ))}

      <p className="flex flex-wrap gap-x-6 text-body">
        <TextLink to={paths.register} standalone>
          Criar conta
        </TextLink>
        <TextLink to={paths.login} standalone>
          Entrar
        </TextLink>
      </p>
    </main>
  );
}
