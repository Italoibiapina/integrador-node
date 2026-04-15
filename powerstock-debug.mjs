import { spawn } from 'node:child_process';

const args = ['--workspace', 'api', 'run', 'debug:powerstock'];

const child =
  process.platform === 'win32'
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], {
        stdio: 'inherit',
        windowsHide: true,
      })
    : spawn('npm', args, { stdio: 'inherit' });

child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});

