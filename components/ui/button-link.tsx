import type { ComponentProps } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonClasses } from "./button";

type ButtonLinkProps = ComponentProps<typeof LocalizedLink> & {
  variant?: Parameters<typeof buttonClasses>[0];
  size?: Parameters<typeof buttonClasses>[1];
};

/** Link styled as a button. Server component (see LocalizedLink). */
export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <LocalizedLink className={buttonClasses(variant, size, className)} {...props} />;
}
