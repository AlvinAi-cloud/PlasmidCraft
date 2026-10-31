// Run after changing the supported types; generated metadata is committed for native builds.
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../src-tauri/", import.meta.url);
export const types = [
  { id: "project", name: "PlasmidCraft Document", ext: ["pcraft"], mime: "application/x-plasmidcraft", own: true },
  { id: "protein", name: "PlasmidCraft Protein", ext: ["pcprotein"], mime: "application/x-plasmidcraft-protein", own: true },
  { id: "genbank", name: "GenBank Sequence", ext: ["gb", "gbk", "genbank"], mime: "chemical/seq-na-genbank" },
  { id: "fasta", name: "FASTA Sequence", ext: ["fa", "fasta", "fna"], mime: "chemical/seq-na-fasta" },
  { id: "protein-fasta", name: "Protein Sequence", ext: ["faa", "pep"], mime: "application/x-plasmidcraft-protein-fasta" },
  { id: "dna", name: "SnapGene DNA Sequence", ext: ["dna"], mime: "application/x-snapgene-dna" },
  { id: "trace", name: "Sanger Trace", ext: ["ab1"], mime: "application/x-abi-trace", role: "Viewer" },
];
const xml = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const str = (s) => `<string>${xml(s)}</string>`;
const arr = (a) => `<array>${a.map(str).join("")}</array>`;
const dict = (d) => `<dict>${Object.entries(d).map(([k,v]) => `<key>${k}</key>${v}`).join("\n")}</dict>`;
export async function generate() {
  const configURL = new URL("tauri.conf.json", root);
  const config = JSON.parse(await fs.readFile(configURL));
  config.bundle.fileAssociations = types.map((t) => ({
    ext: t.ext, name: `PlasmidCraft.${t.id}`, description: t.name,
    role: t.role || "Editor", rank: "Alternate", mimeType: t.mime,
  }));
  config.bundle.macOS.infoPlist = "file-associations/Info.plist";
  config.bundle.resources["icons/document.icns"] = "document.icns";
  config.bundle.resources["icons/document.ico"] = "document.ico";
  config.bundle.windows.nsis.installerHooks = "file-associations/windows.nsh";
  config.bundle.linux = { ...config.bundle.linux, deb: {
    ...config.bundle.linux?.deb,
    files: {
      ...config.bundle.linux?.deb?.files,
      "/usr/share/mime/packages/org.plasmidcraft.desktop.xml": "file-associations/mime.xml",
      ...Object.fromEntries(types.map((t) => [`/usr/share/icons/hicolor/512x512/mimetypes/${t.mime.replaceAll("/", "-")}.png`, "icons/document.png"])),
    },
    postInstallScript: "file-associations/post-install.sh",
    postRemoveScript: "file-associations/post-remove.sh",
  }};
  await fs.writeFile(configURL, JSON.stringify(config, null, 2) + "\n");
  // Windows associations are opt-in: do not let the bundler's legacy APP_ASSOCIATE
  // replace existing extension defaults. Register Open With entries in our hook.
  await fs.writeFile(new URL("tauri.windows.conf.json", root), JSON.stringify({bundle:{fileAssociations:[]}}, null, 2) + "\n");
  const declarations = types.map((t) => dict({
    UTTypeIdentifier: str(`org.plasmidcraft.${t.id}`), UTTypeDescription: str(t.name),
    UTTypeConformsTo: arr([t.own ? "public.data" : ["genbank", "fasta", "protein-fasta"].includes(t.id) ? "public.text" : "public.data"]),
    UTTypeIconFile: str("document.icns"),
    UTTypeTagSpecification: dict({"public.filename-extension": arr(t.ext), "public.mime-type": str(t.mime)}),
  }));
  const info = dict({
    CFBundleDocumentTypes: `<array>${types.map((t) => dict({
      CFBundleTypeName: str(t.name), CFBundleTypeExtensions: arr(t.ext),
      // Shared extensions may already have a UTI owned by another installed app.
      // Keep extension-based matching for them, rather than inventing a conflicting UTI.
      ...(t.own ? { LSItemContentTypes: arr([`org.plasmidcraft.${t.id}`]) } : {}),
      CFBundleTypeRole: str(t.role || "Editor"), LSHandlerRank: str(t.own ? "Owner" : "Alternate"),
      CFBundleTypeIconFile: str("document.icns"),
    })).join("\n")}</array>`,
    UTExportedTypeDeclarations: `<array>${declarations.filter((_,i) => types[i].own).join("\n")}</array>`,
  });
  await fs.writeFile(new URL("file-associations/Info.plist", root), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${info}</plist>\n`);
  await fs.writeFile(new URL("file-associations/mime.xml", root), `<?xml version="1.0" encoding="UTF-8"?>\n<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">\n${types.map((t) => `  <mime-type type="${t.mime}"><comment>${xml(t.name)}</comment>${t.ext.map((e) => `<glob pattern="*.${e}"/>`).join("")}<icon name="${t.mime.replaceAll("/", "-")}"/></mime-type>`).join("\n")}\n</mime-info>\n`);
  const capabilities = `  WriteRegStr SHCTX "Software\\RegisteredApplications" "PlasmidCraft" "Software\\PlasmidCraft\\Capabilities"
  WriteRegStr SHCTX "Software\\PlasmidCraft\\Capabilities" "ApplicationName" "PlasmidCraft"
  WriteRegStr SHCTX "Software\\PlasmidCraft\\Capabilities" "ApplicationDescription" "Plasmid sequence workspace"
${types.flatMap((t) => t.ext.map((e) => `  WriteRegStr SHCTX "Software\\PlasmidCraft\\Capabilities\\FileAssociations" ".${e}" "PlasmidCraft.${t.id}"`)).join("\n")}`;
  const install = types.map((t) => `  WriteRegStr SHCTX "Software\\Classes\\PlasmidCraft.${t.id}" "" "${t.name}"
  WriteRegStr SHCTX "Software\\Classes\\PlasmidCraft.${t.id}\\DefaultIcon" "" '$\\"$INSTDIR\\document.ico$\\",0'
  WriteRegStr SHCTX "Software\\Classes\\PlasmidCraft.${t.id}\\shell\\open\\command" "" '$\\"$INSTDIR\\\${MAINBINARYNAME}.exe$\\" $\\"%1$\\"'
${t.ext.map((e) => `  WriteRegStr SHCTX "Software\\Classes\\.${e}\\OpenWithProgids" "PlasmidCraft.${t.id}" ""`).join("\n")}`).join("\n");
  const uninstall = types.map((t) => `${t.ext.map((e) => `  DeleteRegValue SHCTX "Software\\Classes\\.${e}\\OpenWithProgids" "PlasmidCraft.${t.id}"`).join("\n")}
  DeleteRegKey SHCTX "Software\\Classes\\PlasmidCraft.${t.id}"`).join("\n");
  await fs.writeFile(new URL("file-associations/windows.nsh", root), `; Register choices without changing the user's default applications.\n!macro NSIS_HOOK_POSTINSTALL\n${install}\n${capabilities}\n  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'\n!macroend\n\n!macro NSIS_HOOK_POSTUNINSTALL\n${uninstall}\n  DeleteRegValue SHCTX "Software\\RegisteredApplications" "PlasmidCraft"\n  DeleteRegKey SHCTX "Software\\PlasmidCraft\\Capabilities"\n  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'\n!macroend\n`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await generate();
