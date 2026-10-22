// SPDX-License-Identifier: Apache-2.0
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

export const sourcePath = '/distribution/source.tar.gz';
function escape(value) { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
export async function registerSource(ctx, webServer, env = process.env) {
  if (env.DSH_SOURCE_ARCHIVE === undefined && env.DSH_SOURCE_URL === undefined) return;
  if (env.DSH_SOURCE_ARCHIVE !== '/opt/dsh/source/tavern.tar.gz') throw new Error('forward-auth: source archive must be immutable /opt/dsh/source/tavern.tar.gz');
  const sourceURL = new URL(env.DSH_SOURCE_URL);
  if (sourceURL.protocol !== 'https:' || sourceURL.username || sourceURL.password) throw new Error('forward-auth: source URL must be a public HTTPS source location');
  const archive = env.DSH_SOURCE_ARCHIVE;
  const info = await stat(archive);
  if (!info.isFile()) throw new Error('forward-auth: source archive is not a file');
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: sourcePath,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' });
        response.end();
        return;
      }
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-disposition': 'attachment; filename="dsh-tavern-source.tar.gz"',
        'content-length': String(info.size),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else await pipeline(createReadStream(archive), response);
    },
  }), 'distribution-forward-auth.source-download');
  ctx.effect(() => webServer.tapIndex(html => {
    const notice = `<aside aria-label="Corresponding source" style="position:fixed;bottom:0;left:0;z-index:2147483647;background:#fff;color:#111;padding:4px 8px;font:12px sans-serif"><a href="${sourcePath}">Tavern source (AGPL-3.0)</a> · <a href="${escape(sourceURL.href)}" rel="noopener noreferrer" target="_blank">Distribution source</a></aside>`;
    return html.includes('</body>') ? html.replace('</body>', notice + '</body>') : html + notice;
  }), 'distribution-forward-auth.source-link');
}
