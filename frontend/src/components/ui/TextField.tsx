import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { cn } from "../../lib/cn";
import { IconButton } from "./Button";
import { Field, controlClass, useFieldIds, type FieldLabelProps } from "./Field";

export interface TextFieldProps
  extends Omit<ComponentProps<"input">, "children">, FieldLabelProps {}

/** Campo de texto com rótulo sempre visível. Com `type="password"`, ganha o botão de mostrar. */
export function TextField({
  label,
  optional,
  help,
  error,
  id,
  type = "text",
  className,
  ...rest
}: TextFieldProps) {
  const ids = useFieldIds(id, { help, error });
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";

  return (
    <Field
      ids={ids}
      label={label}
      optional={optional}
      help={help}
      error={error}
      className={className}
    >
      <div className="relative">
        <input
          {...rest}
          id={ids.id}
          type={isPassword && revealed ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cn(controlClass(Boolean(error)), isPassword && "pr-12")}
        />
        {isPassword && (
          <IconButton
            aria-label={revealed ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={revealed}
            className="absolute top-0.5 right-0.5"
            onClick={() => setRevealed((current) => !current)}
          >
            {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </IconButton>
        )}
      </div>
    </Field>
  );
}
