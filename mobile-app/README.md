# GLYPH Studio mobile app

This is a separate Expo/EAS Android app shell for the private GLYPH Studio
workspace. It opens `https://glyphstudio.cv/studio` in a native WebView and
uses the website's existing Supabase sign-in and authorization. It is not a
second copy or a native rewrite of the Vite website. Internet access is
required, and the same studio account and workspace permissions apply.

The app allows navigation only to the studio and its sign-in/account-creation
routes on `glyphstudio.cv`. Public portfolio routes are not opened inside the
app. The `app=mobile` mode gives the workspace a dark, glass-inspired mobile
layout, five-tab navigation, and reduced-motion-aware 3D transitions without
changing the desktop studio. The production website must be deployed before an
EAS build can display these visual changes.

The EAS project is linked to `@obigjohnson/glyph-studio-mobile`.

## Create an installable Android build

1. Install Node.js and create or sign in to an Expo account at
   [expo.dev](https://expo.dev/).
2. From this folder, run:

   ```bash
   npm install
   npx eas-cli@latest login
   ```

   The project ID and Expo account owner are already configured in `app.json`.
3. Deploy the website changes, then build a directly installable APK:

   ```bash
   npx eas-cli@latest build --platform android --profile preview
   ```

   When EAS finishes, open its build link on the Android device and install
   the APK. EAS will prompt to create/manage the Android signing key on the
   first build; keep the generated credentials in the Expo account.
4. For a Google Play release, use the production profile instead. It produces
   an Android App Bundle (`.aab`):

   ```bash
   npx eas-cli@latest build --platform android --profile production
   ```

The Android application ID is `com.glyphstudio.studio`. If that ID is already
registered to another Play Store app, change `expo.android.package` in
`app.json` before the first production build. Do not put Bachs, Supabase
service-role, or other server secrets in this app; the existing website and
server-side functions continue to handle those securely.
