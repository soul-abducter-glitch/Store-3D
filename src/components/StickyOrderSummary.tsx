'use client';

import React from 'react';
import { Package, Truck, CreditCard } from 'lucide-react';

interface CartItem {
  id: string;
  name: string;
  formatLabel: string;
  priceValue: number;
  quantity: number;
  thumbnailUrl: string;
}

interface StickyOrderSummaryProps {
  items: CartItem[];
  subtotal: number;
  deliveryCost: number;
  total: number;
  onCheckout: () => void;
  isProcessing?: boolean;
}

const StickyOrderSummary: React.FC<StickyOrderSummaryProps> = ({
  items,
  subtotal,
  deliveryCost,
  total,
  onCheckout,
  isProcessing = false,
}) => {
  const formatPrice = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="w-full min-w-0 lg:sticky lg:top-24">
      <div className="w-full min-w-0 rounded-[28px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 sm:mb-6">
          <h2 className="text-lg font-semibold text-white">Ваш заказ</h2>
          <span className="text-xs uppercase tracking-[0.3em] text-white/50">
            {itemCount} позиций
          </span>
        </div>

        <div className="mb-5 max-h-[240px] space-y-3 overflow-y-auto pr-1 sm:mb-6 sm:max-h-[320px]">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-2.5 sm:p-3"
            >
              <img
                src={item.thumbnailUrl}
                alt={item.name}
                className="h-10 w-10 rounded-xl object-cover sm:h-12 sm:w-12"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{item.name}</p>
                <p className="text-xs text-white/60">{item.formatLabel}</p>
                <p className="text-xs text-white/50">x{item.quantity}</p>
              </div>
              <div className="shrink-0 text-right text-xs font-semibold text-white sm:text-sm">
                {formatPrice(item.priceValue * item.quantity)}?
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between text-sm text-white/80">
            <span className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Товары
            </span>
            <span className="font-medium">{formatPrice(subtotal)}?</span>
          </div>

          {deliveryCost > 0 && (
            <div className="flex items-center justify-between text-sm text-white/80">
              <span className="flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Доставка
              </span>
              <span className="font-medium">{formatPrice(deliveryCost)}?</span>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-white/10 pt-3 text-lg font-semibold text-white">
            <span className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Итого
            </span>
            <span className="text-[#2ED1FF] shadow-[0_0_14px_rgba(46,209,255,0.35)]">
              {formatPrice(total)}?
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onCheckout}
          disabled={isProcessing || items.length === 0}
          className="mt-6 w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-black shadow-[0_0_18px_rgba(46,209,255,0.35)] transition hover:bg-white/95 hover:shadow-[0_0_26px_rgba(46,209,255,0.55)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isProcessing ? (
            <div className="flex items-center justify-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
              Обрабатываем...
            </div>
          ) : (
            'ПОДТВЕРДИТЬ И ОПЛАТИТЬ'
          )}
        </button>

        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-white/50">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>Безопасная оплата</span>
        </div>
      </div>
    </div>
  );
};

export default StickyOrderSummary;
