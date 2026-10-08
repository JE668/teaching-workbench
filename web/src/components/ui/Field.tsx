import React, { useId } from 'react';
import { cn } from '../../lib/utils';

const baseControl =
  'w-full rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 ' +
  'transition-all duration-200 outline-none ' +
  'hover:border-slate-300 ' +
  'focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

export function Label({
  children,
  required,
  hint,
  htmlFor,
  className,
}: {
  children: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-1.5 flex items-center justify-between', className)}>
      {/* 通过 htmlFor 与控件关联：屏幕阅读器可读，点击标签可聚焦 */}
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {children}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
}

export function Input({ label, required, hint, icon, className, type = 'text', id, ...props }: InputProps) {
  const autoId = useId();
  const inputId = id || autoId;

  const input = (
    <div className="relative">
      {icon && (
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          {icon}
        </div>
      )}
      <input
        id={inputId}
        type={type}
        className={cn(baseControl, 'h-10 px-3.5', icon && 'pl-10', className)}
        {...props}
      />
    </div>
  );

  if (!label) return input;
  return (
    <div>
      <Label required={required} hint={hint} htmlFor={inputId}>
        {label}
      </Label>
      {input}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
}

export function Textarea({ label, required, hint, className, id, ...props }: TextareaProps) {
  const autoId = useId();
  const areaId = id || autoId;

  const area = (
    <textarea
      id={areaId}
      className={cn(baseControl, 'resize-none px-3.5 py-2.5 leading-relaxed', className)}
      {...props}
    />
  );

  if (!label) return area;
  return (
    <div>
      <Label required={required} hint={hint} htmlFor={areaId}>
        {label}
      </Label>
      {area}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function Select({ label, required, hint, options, placeholder, className, id, ...props }: SelectProps) {
  const autoId = useId();
  const selectId = id || autoId;

  const select = (
    <select
      id={selectId}
      className={cn(baseControl, 'h-10 cursor-pointer appearance-none px-3.5 pr-9', className)}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  if (!label) return select;
  return (
    <div>
      <Label required={required} hint={hint} htmlFor={selectId}>
        {label}
      </Label>
      {select}
    </div>
  );
}
