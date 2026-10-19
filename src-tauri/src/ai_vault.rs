//! Device-local API credentials. No plaintext file or profile fallback.
const SERVICE: &str = "org.plasmidcraft.desktop.ai";
const ACCOUNT: &str = "api-connection";
pub(crate) trait Vault {
    fn read(&self) -> Result<Option<Vec<u8>>, String>;
    fn write(&self, value: &[u8]) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}
pub(crate) struct DeviceVault;
#[cfg(target_os = "macos")]
impl Vault for DeviceVault {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        match security_framework::passwords::get_generic_password(SERVICE, ACCOUNT) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err("Keychain could not read the saved API connection. Open AI → Accounts and Models to reconnect.".into()),
        }
    }
    fn write(&self, value: &[u8]) -> Result<(), String> {
        security_framework::passwords::set_generic_password(SERVICE, ACCOUNT, value)
            .map_err(|_| "Keychain could not save the API connection. Unlock Keychain and retry, or turn off Remember on this device for a session-only connection.".into())
    }
    fn delete(&self) -> Result<(), String> {
        match security_framework::passwords::delete_generic_password(SERVICE, ACCOUNT) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25300 => Ok(()),
            Err(_) => Err("Keychain could not remove the saved API connection. Unlock Keychain and retry; the saved key has not been forgotten.".into()),
        }
    }
}
#[cfg(not(target_os = "macos"))]
impl Vault for DeviceVault {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        Ok(None)
    }
    fn write(&self, _: &[u8]) -> Result<(), String> {
        Err("Remember on this device is currently available in the Mac preview through Keychain. Turn it off to connect for this session on this platform.".into())
    }
    fn delete(&self) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    #[ignore = "requires an unlocked macOS Keychain; uses and removes a unique synthetic test item"]
    fn device_keychain_roundtrip() {
        use security_framework::passwords::{
            delete_generic_password, get_generic_password, set_generic_password,
        };
        let service = format!(
            "org.plasmidcraft.desktop.ai.test.{}.{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = delete_generic_password(&self.0, "synthetic-test");
            }
        }
        let cleanup = Cleanup(service);
        let bytes = br#"{"provider":"compatible","apiKey":"synthetic-keychain-test-key"}"#;
        set_generic_password(&cleanup.0, "synthetic-test", bytes)
            .expect("Could not save synthetic Keychain item");
        assert_eq!(
            get_generic_password(&cleanup.0, "synthetic-test").unwrap(),
            bytes
        );
        set_generic_password(&cleanup.0, "synthetic-test", b"synthetic-replacement").unwrap();
        assert_eq!(
            get_generic_password(&cleanup.0, "synthetic-test").unwrap(),
            b"synthetic-replacement"
        );
        delete_generic_password(&cleanup.0, "synthetic-test").unwrap();
        assert_eq!(
            get_generic_password(&cleanup.0, "synthetic-test")
                .unwrap_err()
                .code(),
            -25300
        );
    }
}
