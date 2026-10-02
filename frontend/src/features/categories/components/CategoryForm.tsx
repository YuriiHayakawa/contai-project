import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import {
  isCategoryColor,
  SELECTABLE_CATEGORY_COLORS,
} from "../../../components/ui/category-colors";
import {
  CATEGORY_ICON_LABELS,
  CATEGORY_ICON_NAMES,
  CATEGORY_ICONS,
  FALLBACK_CATEGORY_ICON,
} from "../../../components/ui/category-icons";
import { Notice } from "../../../components/ui/Notice";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { errorMessage, fieldErrors, isApiError } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { categorySchema, type CategoryFormValues } from "../schemas";
import type { Category, CategoryCreateInput, CategoryKind, CategoryTree } from "../types";
import { ColorPicker } from "./ColorPicker";

export interface CategoryFormProps {
  /** Id do `<form>`: o botão de salvar fica no rodapé da folha e aponta para ele. */
  id: string;
  /** Categoria em edição; sem ela, o formulário cria uma categoria nova. */
  category?: Category;
  /** Tipo com que uma categoria nova começa: o da lista que está na tela. */
  defaultKind: CategoryKind;
  /** Árvore de categorias, de onde saem as opções de categoria principal. */
  tree: CategoryTree;
  /** Salva a categoria. Se rejeitar, a mensagem do servidor aparece no campo ou no topo. */
  onSubmit: (input: CategoryCreateInput) => Promise<unknown>;
  /** Avisa quando há dados digitados e não salvos, para a folha não fechar sem querer. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface IconPickerProps {
  label: string;
  value: string;
  onChange: (icon: string) => void;
}

// Campo da API → campo do formulário, para a mensagem do servidor aparecer junto do campo.
const API_FIELDS: Record<string, keyof CategoryFormValues> = {
  name: "name",
  kind: "kind",
  parent_id: "parentId",
  icon: "icon",
  color: "color",
};

const kindOptions = [
  { value: "expense", label: "Despesa" },
  { value: "income", label: "Receita" },
] as const;

const DEFAULT_COLOR = SELECTABLE_CATEGORY_COLORS[0];

/** Escolha do ícone: os desenhos do conjunto adotado, cada um com um nome para quem não vê. */
function IconPicker({ label, value, onChange }: IconPickerProps) {
  const name = useId();

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-label text-ink">{label}</legend>
      <div className="grid grid-cols-6 gap-1 sm:grid-cols-10">
        {CATEGORY_ICON_NAMES.map((icon) => {
          const Icon = CATEGORY_ICONS[icon];
          return (
            <label
              key={icon}
              className="relative flex justify-center"
              title={CATEGORY_ICON_LABELS[icon]}
            >
              <input
                type="radio"
                className="peer sr-only"
                name={name}
                value={icon}
                aria-label={CATEGORY_ICON_LABELS[icon]}
                checked={icon === value}
                onChange={() => onChange(icon)}
              />
              <span
                className={cn(
                  "flex size-11 cursor-pointer items-center justify-center rounded-md text-ink-muted",
                  "transition-colors duration-fast ease-out hover:bg-bg-sunken",
                  "peer-checked:bg-primary peer-checked:text-on-primary",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2",
                  "peer-focus-visible:outline-primary",
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function initialValues(category: Category | undefined, kind: CategoryKind): CategoryFormValues {
  return {
    name: category?.name ?? "",
    kind: category?.kind ?? kind,
    parentId: category?.parent_id ?? "",
    icon: category?.icon ?? FALLBACK_CATEGORY_ICON,
    color: category?.color ?? DEFAULT_COLOR,
  };
}

/**
 * Formulário de categoria: nome, ícone e cor. Ao criar, também o tipo e a categoria principal,
 * que depois não mudam mais.
 */
export function CategoryForm({
  id,
  category,
  defaultKind,
  tree,
  onSubmit,
  onDirtyChange,
}: CategoryFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register: field,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isDirty },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: initialValues(category, defaultKind),
  });
  const kind = useWatch({ control, name: "kind" });

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const parents = tree[kind].filter((parent) => !parent.archived);

  const changeKind = (next: CategoryKind): void => {
    setValue("kind", next, { shouldDirty: true });
    // A categoria principal escolhida era do outro tipo.
    setValue("parentId", "");
  };

  // Uma subcategoria nova começa com a cor da principal; o usuário ainda pode trocar.
  const adoptParentColor = (parentId: string): void => {
    const parent = parents.find((candidate) => candidate.id === parentId);
    if (parent && isCategoryColor(parent.color) && parent.color !== "ardosia") {
      setValue("color", parent.color);
    }
  };

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit({
        name: values.name,
        kind: values.kind,
        parent_id: values.parentId || null,
        icon: values.icon,
        color: values.color,
      });
    } catch (error) {
      const byField = Object.entries(fieldErrors(error)).flatMap(([apiField, message]) => {
        const formField = API_FIELDS[apiField];
        return formField ? [[formField, message] as const] : [];
      });
      // O nome repetido chega como conflito, sem campo: o lugar dele é junto do nome.
      if (isApiError(error) && error.code === "category_name_taken") {
        byField.push(["name", error.message]);
      }
      for (const [formField, message] of byField) {
        setError(formField, { message }, { shouldFocus: true });
      }
      if (byField.length === 0) setFormError(errorMessage(error));
    }
  });

  const parentField = field("parentId");

  return (
    <form id={id} noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
      {formError && <Notice kind="error">{formError}</Notice>}

      {!category && (
        <SegmentedControl label="Tipo" options={kindOptions} value={kind} onChange={changeKind} />
      )}
      <TextField label="Nome" autoComplete="off" error={errors.name?.message} {...field("name")} />
      {!category && (
        <Select
          label="Categoria principal"
          optional
          placeholder="Nenhuma: esta é uma categoria principal"
          help="Escolha uma para criar uma subcategoria dentro dela."
          options={parents.map((parent) => ({ value: parent.id, label: parent.name }))}
          error={errors.parentId?.message}
          {...parentField}
          onChange={(event) => {
            void parentField.onChange(event);
            adoptParentColor(event.target.value);
          }}
        />
      )}
      <Controller
        control={control}
        name="icon"
        render={({ field: icon }) => (
          <IconPicker label="Ícone" value={icon.value} onChange={icon.onChange} />
        )}
      />
      {/* A "Outros" fica sempre na cor neutra, que não está entre as oito da escolha. */}
      {!category?.is_fallback && (
        <Controller
          control={control}
          name="color"
          render={({ field: color }) => (
            <ColorPicker
              label="Cor"
              value={color.value}
              onChange={color.onChange}
              error={errors.color?.message}
            />
          )}
        />
      )}
    </form>
  );
}
