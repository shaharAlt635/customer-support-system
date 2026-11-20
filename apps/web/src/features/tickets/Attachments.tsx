import type { AttachmentDTO } from '@support-desk/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { getErrorMessage } from '../../api/client';
import { attachmentsApi } from '../../api/endpoints';
import { formatBytes } from '../../lib/format';

function FileIcon({ mimeType }: { mimeType: string }) {
  const className = 'size-4 shrink-0 text-slate-400';
  if (mimeType.startsWith('image/')) return <FileImage className={className} aria-hidden />;
  if (mimeType.includes('zip')) return <FileArchive className={className} aria-hidden />;
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType === 'text/csv') {
    return <FileSpreadsheet className={className} aria-hidden />;
  }
  return <FileText className={className} aria-hidden />;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Attachments require the bearer token, so they are fetched as blobs rather than linked. */
async function saveAttachment(attachment: AttachmentDTO) {
  const blob = await attachmentsApi.download(attachment.id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function ImagePreview({ attachment }: { attachment: AttachmentDTO }) {
  // A data URL needs no manual cleanup (unlike object URLs) and is fine for small previews.
  const { data: url } = useQuery({
    queryKey: ['attachment-preview', attachment.id],
    queryFn: async () => blobToDataUrl(await attachmentsApi.download(attachment.id)),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    enabled: attachment.size <= 5 * 1024 * 1024,
  });

  if (!url) return <div className="h-20 w-full animate-pulse rounded-md bg-slate-100" />;
  return (
    <img
      src={url}
      alt={attachment.fileName}
      className="h-20 w-full rounded-md object-cover ring-1 ring-slate-200"
    />
  );
}

function AttachmentItem({ attachment }: { attachment: AttachmentDTO }) {
  const [downloading, setDownloading] = useState(false);
  const isImage = attachment.mimeType.startsWith('image/');

  const onDownload = async () => {
    setDownloading(true);
    try {
      await saveAttachment(attachment);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Download failed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <li className="w-full sm:w-56">
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        title={`Download ${attachment.fileName}`}
        className="group flex w-full flex-col gap-2 rounded-lg bg-white p-2 text-left ring-1 ring-slate-200 transition hover:ring-brand-300"
      >
        {isImage && <ImagePreview attachment={attachment} />}
        <span className="flex w-full items-center gap-2">
          <FileIcon mimeType={attachment.mimeType} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-slate-700">
              {attachment.fileName}
            </span>
            <span className="block text-[11px] text-slate-400">{formatBytes(attachment.size)}</span>
          </span>
          {downloading ? (
            <LoaderCircle className="size-4 animate-spin text-brand-600" aria-hidden />
          ) : (
            <Download className="size-4 text-slate-400 group-hover:text-brand-600" aria-hidden />
          )}
        </span>
      </button>
    </li>
  );
}

export function AttachmentList({ attachments }: { attachments: AttachmentDTO[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
      {attachments.map((attachment) => (
        <AttachmentItem key={attachment.id} attachment={attachment} />
      ))}
    </ul>
  );
}
