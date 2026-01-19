import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Complete your order and choose delivery options.",
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
