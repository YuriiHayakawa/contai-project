import { Link, type LinkProps } from "react-router";

import { cn } from "../../lib/cn";

export interface TextLinkProps extends LinkProps {
  /** Dá ao link uma área de toque de 44px quando ele está sozinho em uma linha. */
  standalone?: boolean;
}

/** Link dentro de texto: tinta azul, sublinhado, e não só a cor. */
export function TextLink({ standalone = false, className, ...rest }: TextLinkProps) {
  return (
    <Link
      {...rest}
      className={cn(
        "rounded-sm font-bold text-primary underline underline-offset-[3px]",
        "transition-colors duration-fast ease-out hover:text-primary-hover",
        standalone && "inline-flex min-h-11 items-center",
        className,
      )}
    />
  );
}
