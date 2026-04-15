import { spawn } from 'node:child_process';

function run(label, args) {
  const child =
    process.platform === 'win32'
      ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], {
          stdio: 'inherit',
          windowsHide: true,
        })
      : spawn('npm', args, {
          stdio: 'inherit',
        });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
    }
  });

  return { label, child };
}

const procs = [
  run('api', ['--workspace', 'api', 'run', 'dev:all']),
  run('web', ['--workspace', 'web', 'run', 'dev']),
];

function shutdown(signal) {
  for (const p of procs) {
    if (process.platform === 'win32') {
      p.child.kill();
    } else {
      p.child.kill(signal);
    }
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
