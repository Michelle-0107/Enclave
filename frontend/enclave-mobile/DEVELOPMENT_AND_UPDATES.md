# Enclave development and EAS Update

The personal development and preview profiles target
`@enclave2210/enclave-mobile-preview`.

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
On the Android development APK, the tunnel QR/manifest may stop at "Reloading"
even when the tunnel is reachable. Once Metro says "Tunnel ready", open a second
terminal and run `npm run dev:url -- <Metro port>` (for example, `8099`). Paste
the complete HTTPS URL it prints into the APK's "Enter URL manually" field.
This opens the JS bundle directly. The direct bundle URL was verified on an
Android phone on 2026-10-23; the plain tunnel URL stalled at "Reloading" and
the HTTP URL failed with a TLS error. Keep Metro and ngrok running while using
the development APK. Re-run `dev:url` after restarting the tunnel because its
hostname changes.
The launcher also forces the personal development-build URL scheme. A locally
generated `android/` directory may still contain the team scheme, even though
EAS excludes that directory. Tunnel mode uses a DNS-safe subdomain because an
underscore in the Expo account name can cause Android to show "Android internal
error" before Metro receives a request. Restart the command after changing the
launcher; old QR codes and tunnel URLs will not use the new settings.

The command does not build an APK, publish an update, or consume an EAS cloud build.
The computer must remain running while the development client uses Metro. An old
standalone preview APK cannot become a development client just by running Metro;
one matching development APK must be installed first.

JavaScript, TypeScript, UI and compatible asset edits can be tested through Metro.
A new native module, Expo SDK upgrade, native permission/configuration change, or
other native runtime change requires a new matching development APK.

## Project selection

- Default app config: team project `@michelle_0107/enclave-mobile`.
- `npm run dev`: personal project `@enclave2210/enclave-mobile-preview`.
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

## EAS Update

`expo-updates` is installed for SDK 57. Both project variants have their own
matching `updates.url`; `runtimeVersion.policy` is `fingerprint` so a native-runtime
change cannot silently target an incompatible binary. Preview and production have
separate update channels.

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
