"use client";

import React from "react";
import { Clock, MapPin, Truck } from "lucide-react";

export interface DeliveryOption {
  id: string;
  name: string;
  price: string;
  description: string;
  icon: React.ReactNode;
  estimatedTime: string;
  features: string[];
}

interface DeliveryCardProps {
  option: DeliveryOption;
  selected: boolean;
  onSelect: (id: string) => void;
}

const DeliveryCard: React.FC<DeliveryCardProps> = ({ option, selected, onSelect }) => {
  return (
    <button
      onClick={() => onSelect(option.id)}
      className={`
        w-full text-left rounded-2xl border-2 p-6 transition-all duration-300 backdrop-blur-xl
        ${selected
          ? "border-[#2ED1FF]/80 bg-[#0b1014] shadow-[0_0_36px_rgba(46,209,255,0.25)]"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
        }
      `}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div
            className={`
              flex h-12 w-12 items-center justify-center rounded-xl
              ${selected ? "bg-[#2ED1FF]/25 text-[#2ED1FF] shadow-[0_0_16px_rgba(46,209,255,0.35)]" : "bg-white/10 text-white/70"}
            `}
          >
            {option.icon}
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-white">{option.name}</h3>
              <span
                className={`
                  text-sm font-medium px-2 py-1 rounded-full
                  ${selected ? "bg-[#2ED1FF]/20 text-[#BFF4FF]" : "bg-white/10 text-white/60"}
                `}
              >
                {option.price}
              </span>
            </div>

            <p className="text-sm text-white/70 mt-1">{option.description}</p>

            <div className="flex items-center gap-4 mt-3 text-xs text-white/60">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {option.estimatedTime}
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                По всей России
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1">
              {option.features.map((feature, index) => (
                <span
                  key={index}
                  className="text-xs px-2 py-1 bg-white/5 text-white/60 rounded-full"
                >
                  {feature}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div
          className={`
            w-4 h-4 rounded-full border-2 transition-all duration-200
            ${selected ? "border-[#2ED1FF] bg-[#2ED1FF] shadow-[0_0_10px_rgba(46,209,255,0.45)]" : "border-white/30 bg-transparent"}
          `}
        >
          {selected && <div className="w-full h-full rounded-full bg-[#050505] scale-50" />}
        </div>
      </div>
    </button>
  );
};

export const deliveryOptions: DeliveryOption[] = [
  {
    id: "cdek",
    name: "СДЭК",
    price: "от 200 ₽",
    description: "Курьер и пункты выдачи",
    icon: <Truck className="h-6 w-6" />,
    estimatedTime: "2–5 дней",
    features: ["Отслеживание", "Страховка", "Подпись при получении"],
  },
  {
    id: "yandex",
    name: "Яндекс.Доставка",
    price: "от 150 ₽",
    description: "Быстрая доставка по городу",
    icon: <Truck className="h-6 w-6" />,
    estimatedTime: "1–3 дня",
    features: ["Экспресс", "Курьер", "SMS-уведомления"],
  },
  {
    id: "ozon",
    name: "OZON Rocket",
    price: "от 100 ₽",
    description: "Пункты выдачи и курьер",
    icon: <Truck className="h-6 w-6" />,
    estimatedTime: "3–7 дней",
    features: ["Широкая сеть", "Уведомления", "Поддержка"],
  },
];

export default DeliveryCard;
