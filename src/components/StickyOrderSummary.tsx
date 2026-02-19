'use client';

import React, { useState } from 'react';
import { Package, Truck, CreditCard, ChevronDown } from 'lucide-react';

interface CartItem {
  id: string;
  name: string;
  formatLabel: string;
  priceValue: number;
  quantity: number;
  thumbnailUrl: string;
  printDetails?: {
    technology?: string;
    material?: string;
    color?: string;
    quality?: string;
    dimensionsLabel?: string;
  };
  editPrintUrl?: string;
}

interface StickyOrderSummaryProps {
  items: CartItem[];
  subtotal: number;
  deliveryCost: number;
  discount?: number;
  promoCode?: string;
  total: number;
  onCheckout: () => void;
  onRemoveItem?: (itemId: string) => void;
  canCheckout?: boolean;
  isProcessing?: boolean;
  ctaLabel?: string;
}

const StickyOrderSummary: React.FC<StickyOrderSummaryProps> = ({
  items,
  subtotal,
  deliveryCost,
  discount = 0,
  promoCode,
  total,
  onCheckout,
  onRemoveItem,
  canCheckout = true,
  isProcessing = false,
  ctaLabel,
}) => {
  const formatPrice = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canPay = !isProcessing && canCheckout;
  const buttonLabel = ctaLabel ?? 'ПОДТВЕРДИТЬ';

  return (
    <div className="w-full min-w-0 lg:sticky lg:top-32">
      <div className="w-full min-w-0 rounded-[28px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 sm:mb-5">
          <h2 className="text-lg font-semibold text-white">Ваш заказ</h2>
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">
            {itemCount} позиций
          </span>
        </div>

        <div className="mb-4 space-y-3 pr-1 sm:mb-5">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-2 sm:p-2.5"
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
                {item.editPrintUrl && (
                  <a
                    href={item.editPrintUrl}
                    className="mt-1 inline-flex rounded-full border border-[#2ED1FF]/35 bg-[#2ED1FF]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-[#BFF4FF] transition hover:border-[#7FE7FF]/70 hover:text-white"
                  >
                    Изменить печать
                  </a>
                )}
                {onRemoveItem && (
                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    className="mt-1 inline-flex rounded-full border border-rose-400/35 bg-rose-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-rose-200 transition hover:border-rose-300/70 hover:text-rose-100"
                  >
                    Удалить
                  </button>
                )}
              </div>
              <div className="shrink-0 text-right text-xs font-semibold text-white tabular-nums sm:text-sm">
                {formatPrice(item.priceValue * item.quantity)}₽
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2.5 border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={() => setDetailsOpen((prev) => !prev)}
            className="flex w-full items-center justify-between text-[10px] uppercase tracking-[0.2em] text-white/60 transition hover:text-white"
          >
            Подробности
            <ChevronDown
              className={`h-4 w-4 transition ${detailsOpen ? 'rotate-180 text-white' : 'text-white/50'}`}
            />
          </button>

          {detailsOpen && (
            <div className="space-y-2 text-sm text-white/80">
              {items.some((item) => item.printDetails) && (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
                  {items.map((item) => {
                    if (!item.printDetails) return null;
                    return (
                      <div key={`details:${item.id}`} className="space-y-1.5 border-b border-white/10 pb-2 last:border-b-0 last:pb-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
                          {item.name}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {item.printDetails.technology && <span>Тех: {item.printDetails.technology}</span>}
                          {item.printDetails.material && <span>Материал: {item.printDetails.material}</span>}
                          {item.printDetails.color && <span>Цвет: {item.printDetails.color}</span>}
                          {item.printDetails.quality && <span>Качество: {item.printDetails.quality}</span>}
                          {item.printDetails.dimensionsLabel && <span>Размер: {item.printDetails.dimensionsLabel}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Товары
                </span>
                <span className="font-medium tabular-nums">{formatPrice(subtotal)}₽</span>
              </div>

              {deliveryCost > 0 && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Truck className="h-4 w-4" />
                    Доставка
                  </span>
                  <span className="font-medium tabular-nums">{formatPrice(deliveryCost)}₽</span>
                </div>
              )}

              {discount > 0 && (
                <div className="flex items-center justify-between text-emerald-300">
                  <span>{promoCode ? `Скидка (${promoCode})` : "Скидка"}</span>
                  <span className="font-medium tabular-nums">-{formatPrice(discount)}₽</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-white/10 pt-3 text-lg font-semibold text-white">
            <span className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Итого
            </span>
            <span className="text-[#2ED1FF] shadow-[0_0_10px_rgba(46,209,255,0.35)] tabular-nums">
              {formatPrice(total)}₽
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onCheckout}
          disabled={!canPay}
          aria-disabled={!canCheckout}
          className={`mt-5 w-full rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-black shadow-[0_0_18px_rgba(46,209,255,0.35)] transition hover:bg-white/95 hover:shadow-[0_0_26px_rgba(46,209,255,0.55)] disabled:cursor-not-allowed disabled:opacity-60 ${
            !canCheckout ? "shadow-[0_0_10px_rgba(46,209,255,0.2)]" : ""
          }`}
        >
          {isProcessing ? (
            <div className="flex items-center justify-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
              Обрабатываем...
            </div>
          ) : (
            buttonLabel
          )}
        </button>

        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-white/50">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>Безопасная оплата</span>
        </div>
      </div>
    </div>
  );
};

export default StickyOrderSummary;

