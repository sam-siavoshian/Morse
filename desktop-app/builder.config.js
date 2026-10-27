// electron-builder settings for Morse Desktop: a Linux AppImage, a macOS dmg
// (signed and notarized when the Apple secrets are there) and a Windows
// installer (signed when the certificate is there). build.js passes this to
// electron-builder; docs/dev/releasing.md says what each secret is.
//
// One architecture per file. The preview Windows installer was 235,410,666
// bytes because one exe carried both x64 and arm64 Electron runtimes.
//
// Signing is skipped, not failed, when its secrets are missing: the build
// still makes an app, just an unsigned one (macOS and Windows then warn the
// person on first open). An unsigned Mac app is still signed "ad hoc" (no
// name, no Apple account): Apple silicon Macs won't run an app without any
// signature, and turning Electron's fuses changes the signed files.

import { ELECTRON_LANGS, trimPackagedRuntime } from "./slim.js";

export function builderConfig({ stage, out, res, electronDist = null, electronVersion, env = process.env }) {
  const macSigned = !!(env.CSC_LINK || env.CSC_NAME);
  const notarize = macSigned && !!((env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) || (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER));
  return {
    appId: "dev.morse.desktop",
    productName: "Morse",
    copyright: "MIT License",
    executableName: "Morse",
    artifactName: "Morse-${version}-${os}-${arch}.${ext}",
    directories: { app: stage, output: out, buildResources: res },
    electronVersion,
    ...(electronDist ? { electronDist } : {}),
    // xz for the AppImage (gzip otherwise). Zip and NSIS use the tighter 7z too.
    compression: "maximum",
    // The app is already staged (build.js): everything in it ships, inside app.asar.
    // Maps, declarations and markdown are build leftovers if a dependency still has them.
    files: ["**/*", "!**/*.map", "!**/*.d.ts", "!**/*.d.mts", "!**/*.d.cts", "!**/*.md", "!**/.github/**"],
    asar: true,
    npmRebuild: false, // no native modules
    // Chromium UI strings for Morse's languages. The rest of locales/ is dropped.
    electronLanguages: ELECTRON_LANGS,
    afterPack: context => trimPackagedRuntime(context.appOutDir),
    // Lock the runtime down: no running it as plain Node, no NODE_OPTIONS, no
    // --inspect, and only the app inside app.asar, checked against its hash.
    electronFuses: {
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
      // No Developer ID: sign ad hoc again after the fuses change the files.
      resetAdHocDarwinSignature: !macSigned,
    },
    // morse://open starts Morse Desktop or shows its window (desktop-app/main.js).
    protocols: [{ name: "Morse", schemes: ["morse"] }],

    linux: {
      target: ["AppImage"],
      category: "Utility",
      icon: `${res}/icon.png`,
      synopsis: "Hack your apps. Build your version.",
      mimeTypes: ["x-scheme-handler/morse"],
      desktop: { entry: { Name: "Morse", Comment: "Hack your apps. Build your version.", StartupWMClass: "Morse" } },
    },

    mac: {
      extraResources: [
        { from: `${res}/morse-native-picker`, to: "morse-native-picker" },
        { from: `${res}/REA-LICENSE`, to: "REA-LICENSE" },
      ],
      // The dmg to download; the zip for whoever prefers one (and for updates later).
      target: [{ target: "dmg", arch: ["arm64", "x64"] }, { target: "zip", arch: ["arm64", "x64"] }],
      category: "public.app-category.productivity",
      icon: `${res}/icon.png`,
      hardenedRuntime: macSigned, // only with a real signature: notarization needs it, ad hoc it only gets in the way
      gatekeeperAssess: false,
      entitlements: `${res}/entitlements.mac.plist`,
      entitlementsInherit: `${res}/entitlements.mac.plist`,
      // Morse quits an open app with AppleScript before opening it again with Morse.
      extendInfo: { NSAppleEventsUsageDescription: "Morse quits an app you chose so it can open it again with Morse connected.", LSUIElement: false },
      // Placeholders until there is an Apple Developer ID (docs/dev/releasing.md):
      // CSC_LINK + CSC_KEY_PASSWORD sign; APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD +
      // APPLE_TEAM_ID (or an App Store Connect API key) notarize.
      identity: macSigned ? undefined : null,
      notarize,
    },
    // ${arch} is empty for x64 and "-arm64" for Apple silicon. Both dmgs are
    // built at once; the same volume name makes hdiutil detach fail and the
    // Mac build is thrown away.
    dmg: { title: "Morse ${version}${arch}", writeUpdateInfo: false },

    win: {
      target: [{ target: "nsis", arch: ["x64", "arm64"] }],
      icon: `${res}/icon.png`,
      // Placeholder until there is a code signing certificate (docs/dev/releasing.md):
      // WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (a .pfx), or Azure Trusted Signing below.
      ...(env.AZURE_TENANT_ID && env.AZURE_SIGNING_ACCOUNT ? { azureSignOptions: {
        publisherName: env.AZURE_PUBLISHER_NAME || "Morse",
        endpoint: env.AZURE_SIGNING_ENDPOINT,
        codeSigningAccountName: env.AZURE_SIGNING_ACCOUNT,
        certificateProfileName: env.AZURE_CERT_PROFILE,
      } } : {}),
    },
    nsis: {
      // Separate installers. build.js renames the x64 one back to
      // Morse-Setup-${version}.exe, the name the site already links to.
      // arm64 is Morse-Setup-${version}-arm64.exe.
      buildUniversalInstaller: false,
      artifactName: "Morse-Setup-${version}-${arch}.exe",
      oneClick: true,
      perMachine: false, // installs for this user only: no admin prompt
      shortcutName: "Morse",
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      deleteAppDataOnUninstall: false, // your mods live in ~/.morse, not here
    },
    publish: null,
  };
}
