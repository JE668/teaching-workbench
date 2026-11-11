import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Type,
  Minus,
  Plus,
  Wand2,
  Loader2,
  X,
  Check,
  Copy,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useToast } from '../ui/Toast';
import { api } from '../../api/client';

export type AIInlineActionType = 'continue' | 'polish' | 'expand' | 'shorten';

interface AIInlineActionsProps {
  /** 当前选中的文本 */
  selectedText: string;
  /** 编辑器的 textarea/ref，用于插入结果 */
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 当前上下文（学生信息、课程信息等），用于生成更准确的内容 */
  context?: Record<string, any>;
  /** 是否启用 */
  enabled?: boolean;
  /** 自定义提示词前缀 */
  promptPrefix?: string;
}

const ACTION_CONFIG: Record<AIInlineActionType, { label: string; icon: React.ReactNode; prompt: string }> = {
  continue: {
    label: '续写',
    icon: <Type className="h-3.5 w-3.5" />,
    prompt: '请自然地续写以下内容，保持原有语调和风格，约 100-200 字：',
  },
  polish: {
    label: '润色',
    icon: <Wand2 className="h-3.5 w-3.5" />,
    prompt: '请润色以下内容，使语言更专业、流畅、有教学感，保持原意不变：',
  },
  expand: {
    label: '扩写',
    icon: <Plus className="h-3.5 w-3.5" />,
    prompt: '请扩写以下内容，增加具体细节、案例或教学建议，约 200-300 字：',
  },
  shorten: {
    label: '精简',
    icon: <Minus className="h-3.5 w-3.5" />,
    prompt: '请精简以下内容，保留核心信息，去除冗余，控制在原长度的 50% 以内：',
  },
};

export function AIInlineActions({
  selectedText,
  editorRef,
  context = {},
  enabled = true,
  promptPrefix = '',
}: AIInlineActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [loadingAction, setLoadingAction] = useState<AIInlineActionType | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Selection | null>(null);
  const toast = useToast();

  // 监听文本选择变化
  useEffect(() => {
    if (!enabled) return;

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || '';

      if (text.length >= 10 && text.length <= 2000) {
        // 获取选区位置
        const range = selection?.getRangeAt(0);
        if (range) {
          const rect = range.getBoundingClientRect();
          selectionRef.current = selection;
          setPosition({
            top: rect.top + window.scrollY - 48, // 悬浮条在选区上方
            left: rect.left + window.scrollX + rect.width / 2,
          });
          setIsOpen(true);
          setResult(null);
        }
      } else {
        setIsOpen(false);
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [enabled]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const buildPrompt = useCallback(
    (action: AIInlineActionType) => {
      const config = ACTION_CONFIG[action];
      const contextStr = Object.entries(context)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join('；');

      return `${promptPrefix}${config.prompt}\n\n${contextStr ? `上下文：${contextStr}\n\n` : ''}原文：\n${selectedText}`;
    },
    [selectedText, context, promptPrefix]
  );

  const handleAction = async (action: AIInlineActionType) => {
    if (!selectedText.trim()) return;

    setLoadingAction(action);
    try {
      const prompt = buildPrompt(action);

      // 调用 AI 生成（使用通用 AI 接口）
      const response = await api.post('/ai/generate', {
        studentName: context.studentName || '学生',
        grade: context.grade || '',
        subject: context.subject || '',
        topic: context.topic || '教学内容',
        modules: ['class_content'],
        classType: context.classType || '一对一',
        module: 'class_content',
        customPrompt: prompt,
      });

      const generatedText = response.content?.trim() || '';
      if (!generatedText) {
        toast.error('AI 生成结果为空');
        return;
      }

      setResult(generatedText);

      // 显示结果预览，用户确认后插入
    } catch (error: any) {
      toast.error(`生成失败：${error.message || '未知错误'}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const insertResult = () => {
    if (!result || !editorRef.current) return;

    const textarea = editorRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // 根据动作类型决定插入方式
    const newText =
      loadingAction === 'continue'
        ? `${selectedText}${result}`
        : result; // 润色/扩写/精简替换选中文本

    textarea.setRangeText(newText, start, end, 'end');
    textarea.focus();
    setIsOpen(false);
    setResult(null);
    toast.success('已插入编辑器');
  };

  const copyResult = () => {
    if (result) {
      navigator.clipboard.writeText(result);
      toast.success('已复制到剪贴板');
    }
  };

  if (!isOpen || !selectedText.trim()) return null;

  return (
    <div
      ref={popoverRef}
      className={cn(
        'fixed z-50 pointer-events-auto',
        'top-0 left-0 transform -translate-x-1/2',
        'transition-opacity duration-150'
      )}
      style={{ top: position.top, left: position.left }}
    >
      {/* 结果预览模式 */}
      {result && (
        <div className="bg-white rounded-xl shadow-lg ring-1 ring-slate-200 p-3 min-w-[280px] max-w-[400px]">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-sm font-medium text-slate-700">AI 生成结果</p>
            <button
              onClick={() => setResult(null)}
              className="text-slate-400 hover:text-slate-600 p-0.5"
              aria-label="关闭预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 mb-3 max-h-48 overflow-y-auto">
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{result}</p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={copyResult}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-600 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              复制
            </button>
            <button
              onClick={insertResult}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              插入编辑器
            </button>
          </div>
        </div>
      )}

      {/* 动作选择模式 */}
      {!result && (
        <div className="bg-white rounded-xl shadow-lg ring-1 ring-slate-200 p-1.5 flex items-center gap-0.5">
          {Object.entries(ACTION_CONFIG).map(([action, config]) => (
            <button
              key={action}
              onClick={() => handleAction(action as AIInlineActionType)}
              disabled={loadingAction !== null}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'focus:outline-none focus:ring-2 focus:ring-brand-500'
              )}
              title={config.label}
            >
              {loadingAction === action ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" />
              ) : (
                config.icon
              )}
              <span className="hidden sm:inline">{config.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 箭头指示器 */}
      <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-5 border-r-5 border-t-5 border-transparent border-t-white" />
    </div>
  );
}

// 便捷 Hook：在任何编辑器中使用 AI 内联动作
export function useAIInlineActions(editorRef: React.RefObject<HTMLTextAreaElement | null>, context?: Record<string, any>) {
  // 预留扩展参数（调用方可按编辑器上下文定制动作），当前实现不读取
  void context;
  const [selectedText, setSelectedText] = useState('');

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || '';
      if (text.length >= 10 && text.length <= 2000) {
        // 检查选择是否在当前编辑器内
        const range = selection?.getRangeAt(0);
        if (range && editorRef.current?.contains(range.commonAncestorContainer)) {
          setSelectedText(text);
        } else {
          setSelectedText('');
        }
      } else {
        setSelectedText('');
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [editorRef]);

  return selectedText;
}