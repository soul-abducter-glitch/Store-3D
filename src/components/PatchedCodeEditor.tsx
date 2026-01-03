"use client";

import React, { useState, useCallback } from 'react';

interface PatchedCodeEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  [key: string]: any;
}

const PatchedCodeEditor: React.FC<PatchedCodeEditorProps> = ({
  value = '',
  onChange,
  placeholder = 'Enter code...',
  readOnly = false,
  className = '',
  ...rest
}) => {
  const [localValue, setLocalValue] = useState(value);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    onChange?.(newValue);
  }, [onChange]);

  return (
    <div className={`code-editor-wrapper ${className}`}>
      <textarea
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        readOnly={readOnly}
        className="w-full min-h-[200px] p-3 border border-gray-300 rounded font-mono text-sm"
        style={{
          resize: 'vertical',
          fontFamily: 'monospace',
        }}
      />
    </div>
  );
};

export default PatchedCodeEditor;
