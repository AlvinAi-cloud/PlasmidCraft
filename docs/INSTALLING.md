# Install PlasmidCraft 0.36

Prepared by **Huiwang Ai at the University of Virginia with ChatGPT Codex**. Contact: [huiwang.ai@virginia.edu](mailto:huiwang.ai@virginia.edu).

Download installers from the [v0.36 release](https://github.com/AlvinAi-cloud/PlasmidCraft/releases/tag/v0.36.0). Save your documents and export library backups before updating.

| Computer | File |
| --- | --- |
| Apple Silicon Mac (M1 or newer) | `PlasmidCraft-0.36.0-macOS-arm64.dmg` |
| Intel Mac | `PlasmidCraft-0.36.0-macOS-x64.dmg` |
| Windows 10/11 x64 | `PlasmidCraft-0.36.0-Windows-x64-setup.exe` |
| Linux x86_64 | `PlasmidCraft-0.36.0-Linux-x86_64.AppImage` |

**Mac:** open the matching DMG and drag **PlasmidCraft 0.36.app** to Applications. The configured minimum is macOS 12.3. These test bundles are ad-hoc signed and not notarized; app-specific verification prompts may appear. For a copy you have verified, use the app-specific Open Anyway control under System Settings → Privacy & Security. Keep general system protections enabled.

**Windows:** run the per-user installer. Microsoft Edge WebView2 Runtime is required and its initial installation may need Internet. The installer is unsigned; follow your organization's unsigned-app policy.

**Linux:** the AppImage contains the application; no separate installer is needed. In a terminal where you downloaded it:

```sh
chmod +x PlasmidCraft-0.36.0-Linux-x86_64.AppImage
./PlasmidCraft-0.36.0-Linux-x86_64.AppImage
```

FUSE 2 may be needed by the distribution. If FUSE is unavailable, use extraction mode:

```sh
APPIMAGE_EXTRACT_AND_RUN=1 ./PlasmidCraft-0.36.0-Linux-x86_64.AppImage
```

The app needs no Node, Python, Rust or Xcode at runtime. Local biology tools work offline; connected AI and NCBI BLAST need Internet and send the context you explicitly choose.

Start with **Help → Getting Started** or **User Guide and Search…**. The supplied pET-21b(+) example opens by default. Save `.pcraft` to retain supported editable state and the chosen circular/linear map display. There is no autosave or crash recovery. See BUILD_REPORT.txt for the exact source commit and CI results, and SHA256SUMS.txt for file integrity hashes.
