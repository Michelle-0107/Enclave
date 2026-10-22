/* global process */
// Print the JS bundle URL that Android development builds can open directly.
// The default Expo tunnel URL opens a manifest first, which can stall in the
// Android development launcher even when the bundle itself is reachable.
const port = Number(process.argv[2] || 8081);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Usage: npm run dev:url -- <Metro port>');
  process.exit(1);
}

async function tunnelForPort() {
  for (let inspectorPort = 4040; inspectorPort <= 4050; inspectorPort += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${inspectorPort}/api/tunnels`, {
        signal: AbortSignal.timeout(700),
      });
      if (!response.ok) continue;
      const { tunnels = [] } = await response.json();
      const tunnel = tunnels.find(({ public_url: url, config }) =>
        url?.startsWith('https://') &&
        new URL(config?.addr).port === String(port)
      );
      if (tunnel) return tunnel.public_url;
    } catch {
      // Each ngrok process may use a different inspector port.
    }
  }
  throw new Error(`No HTTPS ngrok tunnel points to Metro port ${port}. Start npm run dev -- --tunnel --port ${port} first.`);
}

async function main() {
  const tunnelUrl = await tunnelForPort();
  const response = await fetch(tunnelUrl, {
    headers: {
      Accept: 'application/expo+json,application/json',
      'Expo-Platform': 'android',
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Expo manifest returned HTTP ${response.status}.`);
  const manifest = await response.json();
  const bundleUrl = manifest.launchAsset?.url;
  if (!bundleUrl || !bundleUrl.startsWith(`${tunnelUrl}/`)) {
    throw new Error('Expo manifest did not include a bundle URL on this tunnel.');
  }
  console.log(bundleUrl);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
