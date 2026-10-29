"""Collect installed, locked Rust crate license texts for a release.

Run after cargo fetch --locked. No package source code or credentials are copied.
"""
from pathlib import Path
import os
import tomllib
from html.parser import HTMLParser

root = Path(__file__).resolve().parent.parent
cargo = Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))
registries = list((cargo / "registry/src").glob("*"))
lock = tomllib.loads((root / "src-tauri/Cargo.lock").read_text())
parts = ["""PlasmidCraft — third-party notices

PlasmidCraft application code: MIT (see LICENSE).
Tauri and its Rust dependencies retain their respective licenses below.
This inventory covers Cargo.lock, including optional/build/test dependencies.

Data and references:
- Public feature records: INSDC access/use policy https://www.insdc.org/policy/
  Attribution, accession versions and hashes: data/common-features/ and each entry.
- Enzyme factual tables: NEB and Thermo Fisher primary sources credited in
  data/restriction-enzymes/README.md and vendor-facts.json. Trademarks identify
  suppliers and do not imply endorsement. No proprietary feature database ships.
- Codon usage: source records and notices in viewer/codon-usage.mjs and docs/CODON_OPTIMIZATION.md.
- Independent validation uses Biopython (Biopython License Agreement), with
  original license below. Downloaded .dna/.ab1 reference files are developer-only
  fixtures and are excluded from this source distribution and application.
- Node.js, Playwright and the Tauri CLI are development tools, not app runtimes.
- macOS WebKit and Windows WebView2 are operating-system/browser runtimes.

"""]
missing = []
for pkg in lock["package"]:
    if not pkg.get("source", "").startswith("registry+"):
        continue
    name = f"{pkg['name']}-{pkg['version']}"
    folder = next((p / name for p in registries if (p / name).is_dir()), None)
    if folder is None:
        missing.append(name)
        continue
    meta = tomllib.loads((folder / "Cargo.toml").read_text())["package"]
    parts.append(f"\n{'=' * 76}\n{name}\nLicense: {meta.get('license', 'see included license text')}\nhttps://crates.io/crates/{pkg['name']}/{pkg['version']}\n")
    files = sorted(p for p in folder.iterdir() if p.is_file() and p.name.upper().startswith(("LICENSE", "LICENCE", "NOTICE", "COPYING")))
    # AWS-LC's vendored cryptography has its own notices below the crate root.
    if pkg["name"] == "aws-lc-sys":
        files += sorted(p for p in folder.glob("aws-lc/**/LICENSE*") if p.is_file())
    for p in files:
        parts.append(f"\n--- {p.relative_to(folder)} ---\n" + p.read_text(errors="replace") + "\n")
bio_license = root / "data/notices/BIOPYTHON-LICENSE.rst"
if bio_license.exists():
    parts.append("\nBiopython License Agreement\n" + bio_license.read_text())
standard = root / "data/notices/RUST-STANDARD-LIBRARY.html"
if standard.exists():
    class TextNotice(HTMLParser):
        def handle_data(self, data):
            parts.append(data)
        def handle_endtag(self, tag):
            if tag in {"p", "div", "li", "pre", "h1", "h2", "h3", "tr"}:
                parts.append("\n")
    parts.append("\nRust 1.99.1 standard-library distribution notices\n")
    TextNotice(convert_charrefs=True).feed(standard.read_text())
quickjs = root / "data/notices/QUICKJS-LICENSES.txt"
if quickjs.exists():
    parts.append("\nQuickJS computation runtime (MIT)\n" + quickjs.read_text())
if missing:
    raise SystemExit("Run cargo fetch --locked first; missing crates: " + ", ".join(missing))
(root / "THIRD_PARTY_NOTICES.txt").write_text("".join(parts))
print(f"Wrote notices for {sum('source' in p for p in lock['package'])} locked dependencies")
