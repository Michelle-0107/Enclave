const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Exercise the provider's actual sign-in/restore flow with deterministic hooks;
// no credentials, DOM or live Supabase project is needed.
function provider(access, savedToken = null) {
  const state = []; const effects = []; let cursor = 0; let clears = 0;
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = value; }];
    },
    useEffect: effect => { if (!effects.length) effects.push(effect); },
    useCallback: value => value, useMemo: factory => factory(), useContext: () => null,
  };
  const filename = path.resolve(__dirname, '../src/components/auth/AuthProvider.tsx');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    if (name === '@/lib/auth-session') return {
      clearAuthSession: () => { clears++; }, getValidAccessToken: async () => savedToken,
      signInWithPassword: async () => {},
    };
    if (name === '@/lib/api') return {
      ApiError, getCurrentUser: async () => ({ user_id: 'worker-id', email: 'staff@example.com' }),
      getStaffAccess: access,
    };
    throw Error('Unexpected dependency: ' + name);
  } }, { filename });
  return {
    render() { cursor = 0; return module.exports.AuthProvider({ children: null }).props.value; },
    async restore() { effects[0](); await new Promise(resolve => setImmediate(resolve)); },
    get clears() { return clears; },
  };
}

test('a resident/403 fails sign-in instead of becoming maintenance', async () => {
  const app = provider(async () => { throw new ApiError('Staff required', 403); });
  await assert.rejects(app.render().signIn('resident@example.com', 'synthetic'), { status: 403 });
  assert.equal(app.render().role, null); assert.equal(app.render().user, null);
  assert.equal(app.clears, 1);
});

test('only the verified backend staff role is used for both portals', async () => {
  for (const role of ['maintenance', 'management']) {
    const app = provider(async () => ({ user_id: 'worker-id', role }));
    assert.equal(await app.render().signIn('staff@example.com', 'synthetic'), role);
    assert.equal(app.render().role, role);
  }
});

test('mismatched identity and unavailable role service fail closed', async () => {
  for (const access of [
    async () => ({ user_id: 'different-account', role: 'maintenance' }),
    async () => { throw new ApiError('Service unavailable', 503); },
  ]) {
    const app = provider(access);
    await assert.rejects(app.render().signIn('staff@example.com', 'synthetic'));
    assert.equal(app.render().role, null); assert.equal(app.clears, 1);
  }
});

test('a disabled saved staff session is cleared on restore', async () => {
  const app = provider(async () => { throw new ApiError('Disabled', 403); }, 'synthetic-token');
  app.render(); await app.restore();
  const auth = app.render();
  assert.equal(auth.role, null); assert.equal(auth.user, null); assert.equal(auth.ready, true);
  assert.match(auth.error, /active.*staff account/); assert.equal(app.clears, 1);
});
