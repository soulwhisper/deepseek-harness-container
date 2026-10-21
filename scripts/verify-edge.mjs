// CI-only verified-edge simulator. Not shipped as a runtime entrypoint or used in deployments.
// Deliberately forwards opaque HTTP/WebSocket bytes; it never understands mux frames.
import http from 'node:http';
import net from 'node:net';
const { host, port, uid } = JSON.parse(process.argv[1]);
const headersFor = request => {
  const headers = { ...request.headers };
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase().startsWith('x-authentik-')) delete headers[name];
  }
  headers['x-authentik-uid'] = uid;
  return headers;
};
const server = http.createServer((request, response) => {
  const upstream = http.request({ hostname: host, port, path: request.url,
    method: request.method, headers: headersFor(request) }, result => {
    response.writeHead(result.statusCode, result.headers);
    result.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
});
server.on('upgrade', (request, socket, head) => {
  const upstream = net.connect(port, host);
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
  upstream.once('connect', () => {
    const headers = Object.entries(headersFor(request)).flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}\r\n`)).join('');
    upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${headers}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
});
server.listen(8080, '0.0.0.0');
