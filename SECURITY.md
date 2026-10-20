# Reporting security issues

Do not include credentials, private sequences or exploit payloads containing user data in public issues. Once this project is hosted on GitHub, use its private vulnerability reporting feature if enabled; otherwise contact the repository owner privately. No public security contact is configured in this source snapshot.

Supported test release: 0.32. Review dependencies and rebuild before future public releases. Native/network integration tests use synthetic credentials and local servers; passing tests do not constitute a security audit. Test-only PEM keys under src-tauri/tests/fixtures are intentionally public and must never be used as real keys.
