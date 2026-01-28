"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Get order ID from URL params or generate display ID
    const orderIdParam = searchParams.get("orderId");
    
    if (orderIdParam) {
      setOrderId(orderIdParam);
      setIsLoading(false);
    } else {
      // Generate a display timestamp for the order
      setIsLoading(false);
    }
  }, [searchParams]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white">
        <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#2ED1FF]" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -left-40 top-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(46,209,255,0.2),transparent_70%)] blur-2xl" />
        <div className="absolute right-[-15%] top-10 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.16),transparent_70%)] blur-2xl" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-[960px] flex-col items-center justify-center px-6 py-16 text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2ED1FF]/15 text-[#2ED1FF]"
        >
          <CheckCircle2 className="h-9 w-9" />
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <h1 className="mt-6 text-3xl font-semibold text-white">ПРОТОКОЛ ЗАВЕРШЕН</h1>
          <p className="mt-2 text-sm uppercase tracking-[0.3em] text-[#2ED1FF]">ЗАКАЗ ПРИНЯТ</p>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="mt-4"
        >
          {orderId && (
            <p className="text-xs uppercase tracking-[0.2em] text-white/40">
              Номер заказа: <span className="text-[#D4AF37]">#{orderId}</span>
            </p>
          )}
          <p className="mt-2 max-w-2xl text-base text-white/70">
            Ваш заказ успешно обработан. Если вы купили цифровую модель, она уже доступна в вашей
            библиотеке профиля.
          </p>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <Link
            href="/profile"
            className="rounded-full bg-[#2ED1FF] px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-[#050505] transition hover:bg-[#8fe6ff]"
          >
            Перейти в профиль
          </Link>
          <Link
            href="/"
            className="rounded-full border border-white/15 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white/80 transition hover:border-white/30 hover:text-white"
          >
            Вернуться в магазин
          </Link>
        </motion.div>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#050505] text-white">
          <div className="pointer-events-none fixed inset-0 cad-grid-pattern opacity-40" />
          <div className="flex min-h-screen items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#2ED1FF]" />
          </div>
        </div>
      }
    >
      <CheckoutSuccessContent />
    </Suspense>
  );
}
