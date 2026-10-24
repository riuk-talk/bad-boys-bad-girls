import type { ReactNode } from "react";

/**
 * La Découverte and, over it, a folder opened from it (@modal: the intercepted /fiche/[id]). The
 * list stays mounted under the folder, so closing it (or the back button) finds it scrolled as
 * it was. A shared link or a reload of /fiche/[id] shows the Fiche on its own page instead.
 */
export default function DiscoverLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
