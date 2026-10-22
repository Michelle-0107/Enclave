/* global __dirname */
// Start Metro only. This command never builds or publishes an update.
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const projectRoot = path.resolve(__dirname, '..');
const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
// This launcher is for the personal development build. Expo otherwise reads the
// scheme from a local android/ directory, which may belong to the team build.
process.env.ENCLAVE_EXPO_PROJECT = 'personal';
const expoConfig = require(path.join(projectRoot, 'app.config.js'))({
  config: require(path.join(projectRoot, 'app.json')).expo,
});
const devClientScheme = require('expo-dev-client/getDefaultScheme')(expoConfig);
// The default tunnel hostname includes the Expo username. Underscores in that
// hostname cause Android development builds to report "Android internal error".
const env = {
  ...process.env,
  EXPO_TUNNEL_SUBDOMAIN: `enclave-${randomBytes(6).toString('hex')}`,
};
const child = spawn(process.execPath, [cli, 'start', '--dev-client', '--scheme', devClientScheme, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: 'inherit',
  env,
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
