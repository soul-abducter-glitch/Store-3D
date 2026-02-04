'use client';

import React from 'react';
import { Check } from 'lucide-react';

interface Step {
  id: number;
  title: string;
  description: string;
  completed: boolean;
  current: boolean;
}

interface CheckoutStepperProps {
  steps: Step[];
  variant?: 'default' | 'compact';
}

const CheckoutStepper: React.FC<CheckoutStepperProps> = ({ steps, variant = 'default' }) => {
  const isCompact = variant === 'compact';
  return (
    <div className={isCompact ? 'mb-5' : 'mb-8'}>
      <div
        className={`flex flex-col ${isCompact ? 'gap-4' : 'gap-6'} sm:flex-row sm:items-center sm:justify-between`}
      >
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            {/* Step Circle */}
            <div className="flex flex-col items-center">
              <div
                className={`
                  flex items-center justify-center rounded-full border-2 font-semibold transition-all duration-300
                  ${isCompact ? 'h-8 w-8 text-[10px] sm:h-9 sm:w-9 sm:text-xs' : 'h-10 w-10 text-xs sm:h-12 sm:w-12 sm:text-sm'}
                  ${step.current
                    ? 'border-[#2ED1FF] bg-[#2ED1FF]/20 text-[#2ED1FF] shadow-[0_0_20px_rgba(46,209,255,0.35)]'
                    : step.completed
                    ? 'border-[#D4AF37] bg-[#D4AF37]/20 text-[#D4AF37]'
                    : 'border-white/20 bg-white/5 text-white/40'
                  }
                `}
              >
                {step.completed ? (
                  <Check className={isCompact ? 'h-4 w-4' : 'h-6 w-6'} />
                ) : (
                  <span>{step.id}</span>
                )}
              </div>
              {step.current && (
                <span
                  className={`mt-2 h-0.5 rounded-full bg-[#2ED1FF] shadow-[0_0_12px_rgba(46,209,255,0.45)] ${isCompact ? 'w-8' : 'w-10'}`}
                />
              )}

              {/* Step Title */}
              <div className={`text-center ${step.current ? "mt-2" : "mt-3"}`}>
                <p className={`text-xs font-semibold sm:text-sm ${
                  step.current 
                    ? 'text-[#2ED1FF]' 
                    : step.completed 
                    ? 'text-[#D4AF37]'
                    : 'text-white/50'
                }`}>
                  {step.title}
                </p>
                {!isCompact && (
                  <p className="text-xs text-white/60 mt-1 max-w-[120px]">
                    {step.description}
                  </p>
                )}
              </div>
            </div>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div
                className={`
                  sm:flex-1 w-0.5 mx-auto transition-all duration-300 sm:mx-4 sm:w-full
                  ${isCompact ? 'h-5 sm:mt-[-16px] sm:h-0.5' : 'h-8 sm:mt-[-24px] sm:h-0.5'}
                  ${step.completed ? 'bg-[#D4AF37]' : step.current ? 'bg-[#2ED1FF]/40' : 'bg-white/10'}
                `}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default CheckoutStepper;
