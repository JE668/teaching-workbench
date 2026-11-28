import React, { useId, useState, useRef, useEffect, useMemo } from 'react';
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


interface MultiSelectProps {
  label?: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  options: { value: string; label: string }[];
  placeholder?: string;
  value: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  maxDisplay?: number;
  className?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * 多选下拉框
 * - 支持搜索过滤
 * - 选中项以标签形式展示
 * - 可配置最大显示数量，超出显示 "+N"
 */
export function MultiSelect({
  label,
  required,
  hint,
  options,
  placeholder = '请选择',
  value,
  onChange,
  searchable = false,
  maxDisplay = 3,
  className,
  disabled,
  id,
}: MultiSelectProps) {
  const autoId = useId();
  const selectId = id || autoId;
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() =>
    searchable && searchQuery
      ? options.filter(o => o.label.toLowerCase().includes(searchQuery.toLowerCase()))
      : options,
  [options, searchable, searchQuery]);

  const handleToggle = (open?: boolean) => {
    setIsOpen(open ?? !isOpen);
    if (!isOpen) setSearchQuery('');
  };

  const handleSelect = (optionValue: string) => {
    const next = value.includes(optionValue)
      ? value.filter(v => v !== optionValue)
      : [...value, optionValue];
    onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { handleToggle(false); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(); }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(event.target as Node)) {
        handleToggle(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const displayValues = value.slice(0, maxDisplay);
  const remaining = value.length - maxDisplay;

  return (
    <div className={cn(className)}>
      {label && (
        <Label required={required} hint={hint} htmlFor={selectId}>
          {label}
        </Label>
      )}
      <div ref={triggerRef} className="relative">
        <button
          type="button"
          id={selectId}
          onClick={() => handleToggle()}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={`${selectId}-listbox`}
          className={cn(
            baseControl,
            'h-10 px-3.5 pr-9 flex items-center justify-between gap-2',
            isOpen && 'border-brand-400 ring-4 ring-brand-500/10',
            disabled && 'bg-slate-50 text-slate-400 cursor-not-allowed',
          )}
        >
          <span className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0 text-left">
            {value.length === 0 ? (
              <span className="text-slate-400">{placeholder}</span>
            ) : (
              <>
                {displayValues.map(v => {
                  const opt = options.find(o => o.value === v);
                  return (
                    <span key={v} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                      {opt?.label || v}
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); handleSelect(v); }}
                        className="ml-1 p-0.5 text-brand-500 hover:text-brand-700"
                        aria-label={`移除 ${opt?.label || v}`}
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </span>
                  );
                })}
                {remaining > 0 && (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    +{remaining}
                  </span>
                )}
              </>
            )}
          </span>
          <svg className={cn('h-4 w-4 text-slate-400 flex-shrink-0 transition-transform', isOpen && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>

        {isOpen && (
          <div
            ref={dropdownRef}
            id={`${selectId}-listbox`}
            role="listbox"
            aria-multiselectable="true"
            className="absolute z-50 mt-1.5 w-full max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg ring-1 ring-slate-100"
          >
            {searchable && (
              <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
                <input
                  type="text"
                  placeholder="搜索…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  className="w-full h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 outline-none"
                />
              </div>
            )}
            <ul className="py-1" role="presentation">
              {filteredOptions.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-slate-400" role="option" aria-disabled="true">无匹配项</li>
              ) : (
                filteredOptions.map(opt => (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={value.includes(opt.value)}
                    onClick={e => { e.stopPropagation(); handleSelect(opt.value); }}
                    className={cn(
                      'px-3 py-2 text-sm cursor-pointer transition-colors',
                      value.includes(opt.value) ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {value.includes(opt.value) && <svg className="h-4 w-4 text-brand-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>}
                      <span className="truncate">{opt.label}</span>
                    </span>
                  </li>
                ))
              )}
            </ul>
            {value.length > 0 && (
              <div className="border-t border-slate-100 p-2 sticky bottom-0 bg-white">
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onChange([]); }}
                  className="w-full text-center text-xs font-medium text-red-600 hover:text-red-700"
                >
                  清空选择
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
