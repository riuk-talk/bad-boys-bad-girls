import type { ReactNode } from "react";

// The real <html> lives in app/[locale]/layout.tsx (one root layout per locale).
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
