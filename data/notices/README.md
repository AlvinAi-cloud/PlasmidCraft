# Reference and runtime notices

`BIOPYTHON-LICENSE.rst` preserves the Biopython 1.86 license for the independently derived validation references. Original: https://github.com/biopython/biopython/blob/biopython-186/LICENSE.rst . Biopython executable code is not part of the app.

`RUST-STANDARD-LIBRARY.html` is the verbatim `COPYRIGHT-library.html` supplied with Rust 1.99.1, the compiler used for this release. It covers the standard-library distribution, including platform-specific code that may not be linked into these builds. Its text is included in THIRD_PARTY_NOTICES.txt. When changing the release toolchain, refresh these notices from that toolchain's distribution too.

`scripts/third-party-notices.py` assembles installed Cargo.lock crate licenses and these reference/runtime notices. Run it after `cargo fetch --locked`. Notices identify their original authors and terms; the PlasmidCraft MIT license does not replace third-party licenses.
