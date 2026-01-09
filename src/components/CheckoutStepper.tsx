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
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            {/* Step Circle */}
            <div className="flex flex-col items-center">
              <div
                className={`
                  flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all duration-300
                  ${step.current
                    ? 'border-[#2ED1FF] bg-[#2ED1FF]/20 text-[#2ED1FF] shadow-[0_0_20px_rgba(46,209,255,0.3)]'
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
              
              {/* Step Title */}
              <div className="mt-3 text-center">
                <p className={`text-sm font-semibold ${
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
                  flex-1 h-0.5 mx-4 mt-[-24px] transition-all duration-300
                  ${step.completed ? 'bg-[#D4AF37]' : 'bg-white/10'}
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
