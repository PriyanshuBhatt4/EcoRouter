# Expo SDK note

This project runs **Expo SDK 54** (expo ~54.0.0, react-native 0.81.5, react 19.1.0 — see package.json).

Read the version-matched docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code. Do not follow older SDK docs and do not downgrade/upgrade the SDK to resolve doc mismatches; check `node_modules/expo/bundledNativeModules.json` for the compatible package versions and use `npx expo install <pkg>` when adding packages.
