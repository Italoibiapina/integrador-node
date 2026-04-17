import { spawn } from 'node:child_process';

const args = ['--workspace', 'api', 'run', 'debug:powerstock'];
const env =
  process.platform === 'win32'
    ? { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? 'C:\\Trae\\ms-playwright' }
    : process.env;

const child =
  process.platform === 'win32'
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], {
        env,
        stdio: 'inherit',
        windowsHide: true,
      })
    : spawn('npm', args, { env, stdio: 'inherit' });

child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
