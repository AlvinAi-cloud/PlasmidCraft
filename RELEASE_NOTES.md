# PlasmidCraft 0.4

File handling update: installed packages register supported sequence documents with a PlasmidCraft document icon. Files opened from Finder or a file manager are imported directly, with queued startup handling and support for subsequent macOS open events. Default app choices remain user controlled.

- Mirrored forward/reverse primer displays around their DNA strands, with equal template spacing.
- Mismatches and insertions appear as connected unpaired regions; 5′ tails join the binding region without horizontal gaps.
- Primer names and direction arrows sit at the 5′ start, with repeated orientation captions removed.
- Reverse insertions and tails read in the correct displayed orientation. Display changes preserve stored DNA and primer binding sites.

Prepared by Huiwang Ai at the University of Virginia with ChatGPT Codex. Contact: huiwang.ai@virginia.edu.

Mac Intel and Apple Silicon DMGs, Windows x64 NSIS, and Linux Debian/Ubuntu amd64 packages are built by GitHub Actions. Mac packages are ad-hoc signed without notarization; Windows is unsigned.

Feature lists can be imported from an existing SnapGene installation; instructions are in Help → Feature libraries and exchange. Vendor databases are not bundled. Save .pcraft master documents; there is no autosave or crash recovery.
