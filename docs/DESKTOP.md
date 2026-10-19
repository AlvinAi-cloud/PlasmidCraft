# Desktop development

PlasmidCraft is a desktop-only Tauri 2 application. HTML/CSS/JavaScript run inside the native WebView; Rust supplies file dialogs, restricted filesystem commands, menus, clipboard and optional network/account transport. There is no browser product to install or maintain.

README.md contains the current prerequisite, test and build commands. Use the Node/Rust tools installed for your system; no machine-specific paths are needed. Platform prerequisites: https://v2.tauri.app/start/prerequisites/ . On Mac, complete Xcode license and first-launch setup yourself. On Windows, install Visual Studio C++ Build Tools and WebView2.

`pnpm desktop:dev` opens a native development window. `pnpm desktop:build --ci` packages the embedded interface. The app needs neither Node nor an HTTP server at runtime. `scripts/serve.mjs` is a localhost-only internal renderer test harness.

Use the `.command` helper only in a macOS source checkout; installed users open PlasmidCraft 0.31 directly. Export library backups before changing an installed build.

See [release and signing](RELEASE.md) for architectures, packaging, GitHub CI and trust warnings; see [validation](VALIDATION.md) for automated results and outstanding device acceptance.
