import { connect } from 'node:net';

const socket = connect('/tmp/dsh-forward-auth-ready.sock');
let received = '';
const fail = () => { socket.destroy(); process.exitCode = 1; };
socket.setTimeout(2000, fail);
socket.on('error', fail);
socket.on('data', chunk => {
  received += chunk;
  if (received === 'ready\n') { socket.end(); process.exitCode = 0; }
  else if (received.length > 64 || received.includes('\n')) fail();
});
socket.on('end', () => { if (received !== 'ready\n') fail(); });
