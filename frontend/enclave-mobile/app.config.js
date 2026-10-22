// Shared team configuration is the default; personal testing is opt-in.
module.exports = ({ config }) => {
  const target = process.env.ENCLAVE_EXPO_PROJECT || 'team';
  if (!['team', 'personal'].includes(target)) {
    throw new Error('ENCLAVE_EXPO_PROJECT must be team or personal.');
  }
  if (target === 'team') return config;
  const projectId = '226b4663-a8b2-4ee4-a214-3e88bdd2be94';
  return {
    ...config,
    name: 'Enclave Preview',
    owner: 'enclave2210',
    slug: 'enclave-mobile-preview',
    scheme: 'enclave-preview',
    android: { ...config.android, package: 'app.enclavehomes.enclave.preview' },
    extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } },
    updates: { ...config.updates, url: `https://u.expo.dev/${projectId}` },
  };
};
