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
  isProcessing = false
}) => {
  const formatPrice = (value: number) => {
    return new Intl.NumberFormat("ru-RU").format(value);
  };

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="sticky top-24">
      <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">Ваш заказ</h2>
          <span className="text-xs uppercase tracking-[0.3em] text-white/50">
            {itemCount} позиций
          </span>
        </div>

        {/* Items List */}
        <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1 mb-6">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"
            >
              <img
                src={item.thumbnailUrl}
                alt={item.name}
                className="h-12 w-12 rounded-xl object-cover"
              />
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">{item.name}</p>
                <p className="text-xs text-white/60">{item.formatLabel}</p>
                <p className="text-xs text-white/50">x{item.quantity}</p>
              </div>
              <div className="text-right text-sm font-semibold text-white">
                {formatPrice(item.priceValue * item.quantity)}в‚Ѕ
              </div>
            </div>
          ))}
        </div>

        {/* Price Breakdown */}
        <div className="space-y-3 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between text-sm text-white/80">
            <span className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Товары
            </span>
            <span className="font-medium">{formatPrice(subtotal)}в‚Ѕ</span>
          </div>
          
          {deliveryCost > 0 && (
            <div className="flex items-center justify-between text-sm text-white/80">
              <span className="flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Доставка
              </span>
              <span className="font-medium">{formatPrice(deliveryCost)}в‚Ѕ</span>
            </div>
          )}
          
          <div className="flex items-center justify-between text-lg font-semibold text-white border-t border-white/10 pt-3">
            <span className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Итого
            </span>
            <span className="text-[#2ED1FF]">{formatPrice(total)}в‚Ѕ</span>
          </div>
        </div>

        {/* Checkout Button */}
        <button
          onClick={onCheckout}
          disabled={isProcessing || items.length === 0}
          className="mt-6 w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
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

        {/* Security Info */}
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-white/50">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>Безопасная оплата</span>
        </div>
      </div>
    </div>
  );
};

export default StickyOrderSummary;
