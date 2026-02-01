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
}

const CheckoutStepper: React.FC<CheckoutStepperProps> = ({ steps }) => {
  return (
    <div className="mb-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            {/* Step Circle */}
            <div className="flex flex-col items-center">
              <div
                className={`
                  flex h-10 w-10 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all duration-300 sm:h-12 sm:w-12 sm:text-sm
                  ${step.current
                    ? 'border-[#2ED1FF] bg-[#2ED1FF]/20 text-[#2ED1FF] shadow-[0_0_20px_rgba(46,209,255,0.35)]'
                    : step.completed
                    ? 'border-[#D4AF37] bg-[#D4AF37]/20 text-[#D4AF37]'
                    : 'border-white/20 bg-white/5 text-white/40'
                  }
                `}
              >
                {step.completed ? (
                  <Check className="h-6 w-6" />
                ) : (
                  <span>{step.id}</span>
                )}
              </div>
              {step.current && (
                <span className="mt-2 h-0.5 w-10 rounded-full bg-[#2ED1FF] shadow-[0_0_12px_rgba(46,209,255,0.45)]" />
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
                <p className="text-xs text-white/60 mt-1 max-w-[120px]">
                  {step.description}
                </p>
              </div>
            </div>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div
                className={`
                  sm:flex-1 h-8 w-0.5 mx-auto transition-all duration-300 sm:mx-4 sm:mt-[-24px] sm:h-0.5 sm:w-full
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
