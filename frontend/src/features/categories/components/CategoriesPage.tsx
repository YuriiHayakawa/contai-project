import { ChevronRight, Plus } from "lucide-react";
import { useId, useState } from "react";

import { PageContent } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { CategoryChip } from "../../../components/ui/CategoryChip";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Modal } from "../../../components/ui/Modal";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { useToast } from "../../../components/ui/Toast";
import { errorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import {
  categoryLabel,
  useArchiveCategory,
  useCategories,
  useCreateCategory,
  useUnarchiveCategory,
  useUpdateCategory,
} from "../hooks/useCategories";
import {
  CATEGORY_KIND_LABELS,
  type Category,
  type CategoryCreateInput,
  type CategoryKind,
  type CategoryTree,
} from "../types";
import { CategoryForm } from "./CategoryForm";

interface CategoryRowProps {
  category: Category;
  /** Nome mostrado; nas arquivadas, o nome completo, com o da categoria principal. */
  label: string;
  /** Subcategoria: recuada, com o selo menor. */
  nested?: boolean;
  onSelect: (category: Category) => void;
}

interface CategoryEditorProps {
  open: boolean;
  /** Categoria em edição; sem ela, a folha cria uma categoria nova. */
  category?: Category;
  defaultKind: CategoryKind;
  tree: CategoryTree;
  onClose: () => void;
}

interface ArchivedEntry {
  category: Category;
  label: string;
}

const kindOptions = (Object.keys(CATEGORY_KIND_LABELS) as CategoryKind[]).map((value) => ({
  value,
  label: CATEGORY_KIND_LABELS[value],
}));

function CategoryRow({ category, label, nested = false, onSelect }: CategoryRowProps) {
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => onSelect(category)}
        className={cn(
          "flex min-h-14 w-full items-center gap-3 py-2 pr-3 text-left sm:pr-4",
          "transition-colors duration-fast ease-out hover:bg-bg-sunken",
          nested ? "pl-16 sm:pl-17" : "pl-4 sm:pl-5",
        )}
      >
        <CategoryChip color={category.color} icon={category.icon} size={nested ? "sm" : "md"} />
        <span className={cn("min-w-0 flex-1 truncate text-body text-ink", !nested && "font-bold")}>
          {label}
        </span>
        <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-ink-subtle" />
      </button>
    </li>
  );
}

/** Arquivadas de um tipo: as principais e as subcategorias arquivadas de uma principal ativa. */
function archivedEntries(parents: Category[]): ArchivedEntry[] {
  return parents.flatMap((parent) =>
    parent.archived
      ? [{ category: parent, label: categoryLabel(parent) }]
      : parent.children
          .filter((child) => child.archived)
          .map((child) => ({ category: child, label: categoryLabel(child, parent) })),
  );
}

/** Folha de criação e edição de uma categoria, com a ação de arquivar. */
function CategoryEditor({ open, category, defaultKind, tree, onClose }: CategoryEditorProps) {
  const formId = useId();
  const toast = useToast();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const archive = useArchiveCategory();
  const unarchive = useUnarchiveCategory();
  const [dirty, setDirty] = useState(false);

  const saving = create.isPending || update.isPending;

  const close = (): void => {
    setDirty(false);
    onClose();
  };

  const save = async (input: CategoryCreateInput): Promise<void> => {
    if (category) {
      await update.mutateAsync({
        id: category.id,
        input: {
          name: input.name,
          icon: input.icon,
          // A "Outros" fica sempre na cor neutra: a cor dela não é enviada.
          ...(category.is_fallback ? {} : { color: input.color }),
        },
      });
      toast.success("Categoria atualizada.");
    } else {
      await create.mutateAsync(input);
      toast.success("Categoria criada.");
    }
    close();
  };

  const archiveIt = (target: Category): void => {
    archive.mutate(target.id, {
      onSuccess: () => {
        toast.success("Categoria arquivada. Os lançamentos antigos continuam com ela.", {
          action: { label: "Desfazer", onClick: () => unarchive.mutate(target.id) },
        });
        close();
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  const unarchiveIt = (target: Category): void => {
    unarchive.mutate(target.id, {
      onSuccess: () => {
        toast.success("Categoria desarquivada.");
        close();
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={category ? "Editar categoria" : "Nova categoria"}
      size="form"
      preventDismiss={dirty || saving}
      footer={
        <>
          <Button type="submit" form={formId} loading={saving}>
            {category ? "Salvar categoria" : "Criar categoria"}
          </Button>
          <Button variant="secondary" disabled={saving} onClick={close}>
            Cancelar
          </Button>
        </>
      }
    >
      <CategoryForm
        key={category?.id ?? `new-${defaultKind}`}
        id={formId}
        category={category}
        defaultKind={defaultKind}
        tree={tree}
        onSubmit={save}
        onDirtyChange={setDirty}
      />
      {category && !category.is_fallback && (
        <div className="mt-4 border-t border-border pt-2">
          {category.archived ? (
            <Button
              variant="ghost"
              className="-ml-5"
              loading={unarchive.isPending}
              onClick={() => unarchiveIt(category)}
            >
              Desarquivar categoria
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="-ml-5"
              loading={archive.isPending}
              onClick={() => archiveIt(category)}
            >
              Arquivar categoria
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}

interface CategoryGroupProps {
  parent: Category;
  onSelect: (category: Category) => void;
}

/** Uma categoria principal seguida das subcategorias ativas dela. */
function CategoryGroup({ parent, onSelect }: CategoryGroupProps) {
  return (
    <>
      <CategoryRow category={parent} label={parent.name} onSelect={onSelect} />
      {parent.children
        .filter((child) => !child.archived)
        .map((child) => (
          <CategoryRow
            key={child.id}
            category={child}
            label={child.name}
            nested
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

/** Categorias e subcategorias do usuário, por tipo; as arquivadas ficam em um grupo à parte. */
export function CategoriesPage() {
  const categories = useCategories();
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [editorOpen, setEditorOpen] = useState(false);
  // Fica guardada depois de fechar, para a folha não trocar de conteúdo enquanto sai da tela.
  const [editing, setEditing] = useState<Category | undefined>(undefined);

  const openEditor = (category?: Category): void => {
    setEditing(category);
    setEditorOpen(true);
  };

  const tree = categories.data;
  const active = tree?.[kind].filter((parent) => !parent.archived) ?? [];
  const archived = tree ? archivedEntries(tree[kind]) : [];

  return (
    <PageContent>
      <PageHeader title="Categorias" />

      {categories.isPending && (
        <Card flush>
          <SkeletonList label="Carregando suas categorias…" />
        </Card>
      )}

      {categories.isError && (
        <EmptyState
          kind="error"
          title="Não foi possível carregar suas categorias"
          description={errorMessage(categories.error)}
          onAction={() => void categories.refetch()}
        />
      )}

      {tree && (
        <div className="grid gap-6">
          <SegmentedControl
            label="Tipo de categoria"
            hideLabel
            options={kindOptions}
            value={kind}
            onChange={setKind}
          />

          <Card
            flush
            title={CATEGORY_KIND_LABELS[kind]}
            action={
              <Button
                variant="ghost"
                className="-mr-3"
                icon={<Plus />}
                onClick={() => openEditor()}
              >
                Nova categoria
              </Button>
            }
          >
            {active.length > 0 ? (
              <ul className="border-t border-border">
                {active.map((parent) => (
                  <CategoryGroup key={parent.id} parent={parent} onSelect={openEditor} />
                ))}
              </ul>
            ) : (
              <p className="border-t border-border px-4 py-4 text-body text-ink-muted sm:px-5">
                Não há categorias ativas aqui. Crie uma ou desarquive uma das arquivadas.
              </p>
            )}
          </Card>

          {archived.length > 0 && (
            <Card flush title="Arquivadas">
              <ul className="border-t border-border">
                {archived.map(({ category, label }) => (
                  <CategoryRow
                    key={category.id}
                    category={category}
                    label={label}
                    onSelect={openEditor}
                  />
                ))}
              </ul>
            </Card>
          )}

          <CategoryEditor
            open={editorOpen}
            category={editing}
            defaultKind={kind}
            tree={tree}
            onClose={() => setEditorOpen(false)}
          />
        </div>
      )}
    </PageContent>
  );
}
