import { Skeleton, SkeletonList } from "../ui/Skeleton";
import { PageContent, type PageContentProps } from "./AppShell";

export type PageSkeletonProps = Pick<PageContentProps, "wide">;

/** Ocupa o lugar de uma tela enquanto o código ou os dados dela chegam. */
export function PageSkeleton({ wide }: PageSkeletonProps) {
  return (
    <PageContent wide={wide}>
      <div className="mb-5 flex min-h-11 items-center">
        <Skeleton className="h-7 w-44" />
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <SkeletonList />
      </div>
    </PageContent>
  );
}
