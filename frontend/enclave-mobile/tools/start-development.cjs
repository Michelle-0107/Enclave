/* global __dirname */
// Start Metro only. This command never builds or publishes an update.
const { spawn } = require('node:child_process');
const path = require('node:path');
const projectRoot = path.resolve(__dirname, '..');
const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
const child = spawn(process.execPath, [cli, 'start', '--dev-client', ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, ENCLAVE_EXPO_PROJECT: 'personal' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
