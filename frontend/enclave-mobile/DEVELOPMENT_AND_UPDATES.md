# Enclave development and EAS Update

Configuration is prepared locally. No new cloud build, APK, update publication,
submission, or deployment was created for this setup.

## Daily phone testing

After installing a development APK containing this native configuration, run:

```powershell
cd frontend/enclave-mobile
npm run dev
```

This starts Metro with `--dev-client`, selects the existing personal Expo project,
and loads the existing local `.env`. Open the installed development app and connect
to this server. Keep the computer and phone on the same network. If LAN access is
not available, `npm run dev -- --tunnel` uses Expo's tunnel support instead.

The command does not build an APK, publish an update, or consume an EAS cloud build.
The computer must remain running while the development client uses Metro. An old
standalone preview APK cannot become a development client just by running Metro;
one matching development APK must be installed first, when a build is explicitly
requested. None was built during this configuration task.

JavaScript, TypeScript, UI and compatible asset edits can be tested through Metro.
A new native module, Expo SDK upgrade, native permission/configuration change, or
other native runtime change requires a new matching development APK.

## Project selection

- Default app config: team project `@michelle_0107/enclave-mobile`.
- `npm run dev`: personal project `@leekaixuan/enclave-mobile-preview`.
- `development`: team development profile.
- `development-personal`: personal development profile; inherits development-client
  behavior and APK output, and uses the existing personal `preview` environment for
  the three public backend/Supabase variables.
- `preview` and `preview-personal`: standalone preview profiles for later optional
  EAS Update testing. Production remains a separate channel.

`app.config.js` changes the owner, slug, Android package and update URL together
only when `ENCLAVE_EXPO_PROJECT=personal`. The shared team identity is preserved.
The personal profiles set this selector for both local EAS config evaluation and
remote build configuration. Do not copy credentials between the projects.

Read-only profile verification (does not create a build):

```powershell
npx eas-cli@latest config --platform android --profile development-personal --json
```

The existing app `.env` contains only EXPO_PUBLIC_API_URL,
EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY. Backend service-role
keys must never be used in the app. `.easignore` excludes env and signing files
from future uploads. EAS uses the already configured public environment variables.

## EAS Update is prepared for later use

`expo-updates` is installed for SDK 57. Both project variants have their own
matching `updates.url`; `runtimeVersion.policy` is `fingerprint` so a native-runtime
change cannot silently target an incompatible binary. Preview and production have
separate update channels. No update was published and no remote channel or build
was created by this setup.

Development builds normally load code from Metro. Their launcher can also preview
compatible published updates, but they do not behave like an automatically
updating standalone preview release. There is no need to publish an EAS Update
for each edit during local development.

Prefer the development client and Metro first. Run cloud build/update/submit
commands only when they are explicitly requested; do not automatically retry a
failed cloud build. EAS Update has its own service usage limits even when no
native build is required.

## Validation notes

App config and personal EAS profile resolution, TypeScript and the development
launcher help command are checked without creating a build. Existing screen lint
errors (JSX apostrophes and React hook/purity rules) are outside this configuration
change. They were not hidden by disabling lint rules.

Official references:
- https://docs.expo.dev/versions/v57.0.0/sdk/updates/
- https://docs.expo.dev/eas-update/getting-started/
- https://docs.expo.dev/develop/development-builds/introduction/
