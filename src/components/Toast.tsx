'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, X, AlertCircle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const ToastIcon = ({ type }: { type: ToastType }) => {
  const iconProps = { size: 20 };
  
  switch (type) {
    case 'success':
      return <CheckCircle {...iconProps} className="text-emerald-400" />;
    case 'error':
      return <AlertCircle {...iconProps} className="text-red-400" />;
    case 'warning':
      return <AlertCircle {...iconProps} className="text-yellow-400" />;
    case 'info':
    default:
      return <Info {...iconProps} className="text-[#2ED1FF]" />;
  }
};

const ToastComponent = ({ toast, onRemove }: ToastProps) => {
  useEffect(() => {
    const duration = toast.duration || 4000;
    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  const getToastStyles = (type: ToastType) => {
    switch (type) {
      case 'success':
        return 'border-emerald-500/30 bg-emerald-500/10';
      case 'error':
        return 'border-red-500/30 bg-red-500/10';
      case 'warning':
        return 'border-yellow-500/30 bg-yellow-500/10';
      case 'info':
      default:
        return 'border-[#2ED1FF]/30 bg-[#2ED1FF]/10';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -50, scale: 0.9 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`
        flex items-center gap-3 rounded-2xl border backdrop-blur-xl p-4 
        ${getToastStyles(toast.type)}
      `}
    >
      <ToastIcon type={toast.type} />
      <p className="text-sm font-medium text-white flex-1">
        {toast.message}
      </p>
      <button
        onClick={() => onRemove(toast.id)}
        className="text-white/40 hover:text-white transition-colors"
      >
        <X size={16} />
      </button>
    </motion.div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center';
}

export const ToastContainer = ({ 
  toasts, 
  onRemove, 
  position = 'top-right' 
}: ToastContainerProps) => {
  const getPositionStyles = () => {
    switch (position) {
      case 'top-left':
        return 'top-6 left-6';
      case 'top-center':
        return 'top-6 left-1/2 -translate-x-1/2';
      case 'bottom-right':
        return 'bottom-6 right-6';
      case 'bottom-left':
        return 'bottom-6 left-6';
      case 'top-right':
      default:
        return 'top-6 right-6';
    }
  };

  return (
    <div className={`fixed z-50 ${getPositionStyles()}`}>
      <div className="flex flex-col gap-3">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <ToastComponent
              key={toast.id}
              toast={toast}
              onRemove={onRemove}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

// Toast Manager Hook
export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const showSuccess = (message: string, duration?: number) => {
    addToast({ type: 'success', message, duration });
  };

  const showError = (message: string, duration?: number) => {
    addToast({ type: 'error', message, duration });
  };

  const showInfo = (message: string, duration?: number) => {
    addToast({ type: 'info', message, duration });
  };

  const showWarning = (message: string, duration?: number) => {
    addToast({ type: 'warning', message, duration });
  };

  return {
    toasts,
    addToast,
    removeToast,
    showSuccess,
    showError,
    showInfo,
    showWarning,
  };
};
