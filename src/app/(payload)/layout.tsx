import type { ReactNode } from "react";

import "@payloadcms/next/css";

type LayoutProps = {
  children: ReactNode;
};

export default function PayloadLayout({ children }: LayoutProps) {
  return children;
}
