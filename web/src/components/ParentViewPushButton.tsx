import { FormEvent, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import Button from './ui/Button';
import { Input } from './ui/Field';
import Modal from './ui/Modal';

interface ParentViewPushButtonProps {
  disabled?: boolean;
  loading?: boolean;
  onPush: (parentOpenId: string) => Promise<boolean>;
}

/** 教师显式输入公众号 OpenID 后推送；不收集 AppSecret 等平台凭据。 */
export function ParentViewPushButton({ disabled, loading, onPush }: ParentViewPushButtonProps) {
  const [open, setOpen] = useState(false);
  const [parentOpenId, setParentOpenId] = useState('');
  const [error, setError] = useState('');

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const clean = parentOpenId.trim();
    if (!clean || clean.length > 128) {
      setError('请输入 1–128 个字符的家长 OpenID');
      return;
    }
    setError('');
    const succeeded = await onPush(clean);
    if (succeeded) setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={<MessageSquareText className="h-4 w-4" />}
        disabled={disabled || loading}
        onClick={() => setOpen(true)}
        title="生成家长视图并发送公众号模板消息，可携带小程序卡片"
      >
        微信推送
      </Button>
      <Modal
        open={open}
        onClose={() => { if (!loading) setOpen(false); }}
        title="微信推送家长视图"
        description="生成查阅链接并发送模板消息；链接会同时复制，推送失败不影响使用链接。"
        size="sm"
        footer={(
          <>
            <Button type="button" variant="ghost" disabled={loading} onClick={() => setOpen(false)}>取消</Button>
            <Button type="button" loading={loading} onClick={() => void submit()}>生成并推送</Button>
          </>
        )}
      >
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <Input
            label="家长公众号 OpenID"
            value={parentOpenId}
            onChange={(event) => setParentOpenId(event.target.value)}
            placeholder="请输入家长在公众号内的 OpenID"
            maxLength={128}
            autoFocus
            disabled={loading}
          />
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <p className="text-xs leading-5 text-slate-500">
            需在服务端配置公众号与模板参数；配置小程序 AppID 后，模板消息会附带本页面的原生小程序卡片。
          </p>
        </form>
      </Modal>
    </>
  );
}
