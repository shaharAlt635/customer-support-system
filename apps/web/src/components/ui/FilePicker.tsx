import { DEFAULT_MAX_FILES_PER_UPLOAD, DEFAULT_MAX_UPLOAD_SIZE_MB } from '@support-desk/shared';
import { FileText, Paperclip, UploadCloud, X } from 'lucide-react';
import { type DragEvent, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { usePublicConfig } from '../../api/queries';
import { cn } from '../../lib/cn';
import { formatBytes } from '../../lib/format';
import { Button } from './Button';

interface FilePickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  variant?: 'dropzone' | 'compact';
  disabled?: boolean;
}

/** Validates type, size and count on the client using the limits the server publishes. */
function useUploadRules() {
  const { data } = usePublicConfig();
  return {
    maxBytes: data?.uploads.maxFileSizeBytes ?? DEFAULT_MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    maxFiles: data?.uploads.maxFiles ?? DEFAULT_MAX_FILES_PER_UPLOAD,
    extensions: data?.uploads.allowedExtensions ?? [],
  };
}

export function FilePicker({ files, onChange, variant = 'dropzone', disabled }: FilePickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const rules = useUploadRules();

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const accepted: File[] = [];
    for (const file of Array.from(incoming)) {
      const extension = file.name.includes('.')
        ? `.${file.name.split('.').pop()!.toLowerCase()}`
        : '';
      if (rules.extensions.length && !rules.extensions.includes(extension)) {
        toast.error(`"${file.name}" has an unsupported file type`);
      } else if (file.size > rules.maxBytes) {
        toast.error(`"${file.name}" is larger than ${formatBytes(rules.maxBytes)}`);
      } else if (file.size === 0) {
        toast.error(`"${file.name}" is empty`);
      } else {
        accepted.push(file);
      }
    }
    const next = [...files, ...accepted];
    if (next.length > rules.maxFiles) toast.error(`You can attach up to ${rules.maxFiles} files`);
    onChange(next.slice(0, rules.maxFiles));
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) addFiles(event.dataTransfer.files);
  };

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      multiple
      className="sr-only"
      accept={rules.extensions.join(',') || undefined}
      disabled={disabled}
      onChange={(event) => addFiles(event.target.files)}
    />
  );

  const list = files.length > 0 && (
    <ul className="mt-2 flex flex-wrap gap-2">
      {files.map((file, index) => (
        <li
          key={`${file.name}-${index}`}
          className="flex max-w-full items-center gap-2 rounded-lg bg-slate-100 py-1 pr-1 pl-2.5 text-xs text-slate-700"
        >
          <FileText className="size-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="truncate">{file.name}</span>
          <span className="shrink-0 text-slate-400">{formatBytes(file.size)}</span>
          <button
            type="button"
            onClick={() => onChange(files.filter((_, i) => i !== index))}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            aria-label={`Remove ${file.name}`}
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );

  if (variant === 'compact') {
    return (
      <div>
        {input}
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || files.length >= rules.maxFiles}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="size-4" />
          Attach files
        </Button>
        {list}
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition',
          dragging
            ? 'border-brand-400 bg-brand-50'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        <UploadCloud className="size-6 text-slate-400" aria-hidden />
        <span className="mt-2 text-sm text-slate-600">
          <span className="font-medium text-brand-600">Choose files</span> or drag them here
        </span>
        <span className="mt-1 text-xs text-slate-400">
          Up to {rules.maxFiles} files, {formatBytes(rules.maxBytes)} each · images, PDF, text,
          office documents, ZIP
        </span>
        {input}
      </label>
      {list}
    </div>
  );
}
