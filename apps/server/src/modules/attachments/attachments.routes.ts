import type { FastifyPluginAsync } from 'fastify';
import { parseIdParam } from '../../lib/validation';

/** RFC 6266 / 5987 Content-Disposition with a safe ASCII fallback. */
function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export const attachmentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id/download', { preHandler: app.authenticate }, async (request, reply) => {
    const id = parseIdParam(request.params, 'Attachment');
    const file = await app.services.attachments.openForDownload(request.user, id);

    // Always download (never render) user content, and forbid MIME sniffing.
    return reply
      .header('Content-Type', file.mimeType)
      .header('Content-Length', file.size)
      .header('Content-Disposition', contentDisposition(file.fileName))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=0, must-revalidate')
      .send(file.stream);
  });
};
