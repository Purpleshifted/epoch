import { spawn } from 'node:child_process';

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    ...opts,
  });
  return child;
}

const procs = [];

// Realtime server
const realtimeEnv = {
  ...process.env,
  PORT: process.env.REALTIME_PORT || '3001',
  HOST: process.env.REALTIME_HOST || '0.0.0.0',
};
procs.push(run('node', ['/app/realtime/dist/index.js'], { env: realtimeEnv }));

// Next.js standalone server
const webEnv = {
  ...process.env,
  PORT: process.env.WEB_PORT || '3000',
  HOST: process.env.WEB_HOST || '0.0.0.0',
};
procs.push(run('node', ['/app/web/server.js'], { cwd: '/app/web', env: webEnv }));

function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down...`);
  for (const p of procs) {
    try { p.kill(signal); } catch {
      // ignore
    }
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Exit when any child exits; bubble code
procs.forEach((p) => {
  p.on('exit', (code, sig) => {
    if (sig) {
      process.exit(128 + (sig === 'SIGKILL' ? 9 : 15));
    } else {
      process.exit(code ?? 0);
    }
  });
});
