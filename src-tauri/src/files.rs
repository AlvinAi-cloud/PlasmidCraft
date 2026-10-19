//! Atomic replacement, restricted to paths granted by native user dialogs.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri_plugin_fs::FsExt;
const MAX_BYTES: usize = 50 * 1024 * 1024;
fn checked_path(path: &Path, allowed: impl Fn(&Path) -> bool) -> Result<PathBuf, String> {
    if !path.is_absolute() || !allowed(path) {
        return Err("Choose this destination through Save As before writing it.".into());
    }
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) && !path.exists() {
        return Err("The destination is a broken symbolic link. Choose Save As again.".into());
    }
    let target = if path.exists() {
        path.canonicalize()
    } else {
        path.parent()
            .ok_or("A destination folder is required.")?
            .canonicalize()
            .map(|parent| parent.join(path.file_name().unwrap_or_default()))
    }
    .map_err(|_| "The selected destination is unavailable. Choose Save As again.")?;
    if !allowed(&target) {
        return Err(
            "The resolved destination is outside the selected file access. Choose Save As again."
                .into(),
        );
    }
    Ok(target)
}
fn replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_BYTES {
        return Err("The document exceeds the 50 MB file limit.".into());
    }
    let metadata = match fs::metadata(path) {
        Ok(m) => Some(m),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Cannot inspect the destination: {e}")),
    };
    if let Some(m) = &metadata {
        if !m.is_file() || m.permissions().readonly() {
            return Err(
                "The destination is read-only or is not a regular file. Choose another location."
                    .into(),
            );
        }
    }
    let parent = path.parent().ok_or("A destination folder is required.")?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".plasmidcraft-save-")
        .tempfile_in(parent)
        .map_err(|e| format!("Cannot create a temporary save in the destination folder: {e}"))?;
    temporary
        .write_all(bytes)
        .map_err(|e| format!("Save failed before replacing the original file: {e}"))?;
    if let Some(m) = metadata {
        temporary
            .as_file()
            .set_permissions(m.permissions())
            .map_err(|e| format!("Cannot preserve file permissions: {e}"))?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|e| format!("Cannot finish writing the new file: {e}"))?;
    temporary.persist(path).map_err(|e| {
        format!(
            "Cannot replace the destination; its previous contents were retained: {}",
            e.error
        )
    })?;
    #[cfg(unix)]
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}
#[tauri::command]
pub async fn save_file_atomic<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    use base64::Engine;
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("The native save service requires binary data.".into()),
    };
    if data.len() > MAX_BYTES {
        return Err("The document exceeds the 50 MB file limit.".into());
    }
    let encoded = request
        .headers()
        .get("x-plasmidcraft-path")
        .and_then(|v| v.to_str().ok())
        .filter(|v| v.len() <= 32768)
        .ok_or("The selected save destination is missing.")?;
    let path = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| "Invalid save destination encoding.")?,
    )
    .map_err(|_| "The save destination is not valid Unicode.")?;
    let scope = app.fs_scope();
    let target = checked_path(Path::new(&path), |p| scope.is_allowed(p))?;
    let bytes = data.clone();
    tauri::async_runtime::spawn_blocking(move || replace(&target, &bytes))
        .await
        .map_err(|_| "The native save task did not finish.")?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binary_ipc_requires_selected_file_scope_and_handles_unicode_paths() {
        use base64::Engine;
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .invoke_handler(tauri::generate_handler![save_file_atomic])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("质粒 α.pcraft");
        let request = || {
            let headers = Default::default();
            let mut request = tauri::webview::InvokeRequest {
                cmd: "save_file_atomic".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Raw(b"complete project".to_vec()),
                headers,
                invoke_key: tauri::test::INVOKE_KEY.into(),
            };
            request.headers.insert(
                "x-plasmidcraft-path",
                base64::engine::general_purpose::STANDARD
                    .encode(path.to_str().unwrap())
                    .parse()
                    .unwrap(),
            );
            request
        };
        assert!(tauri::test::get_ipc_response(&window, request()).is_err());
        assert!(!path.exists());
        app.fs_scope().allow_file(&path).unwrap();
        tauri::test::get_ipc_response(&window, request()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"complete project");
    }
    #[test]
    fn replacements_preserve_the_old_file_on_validation_failure_and_clean_temporary_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sequence.pcraft");
        replace(&path, b"old complete project").unwrap();
        replace(&path, b"new complete project").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new complete project");
        assert!(replace(&path, &vec![0; MAX_BYTES + 1]).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"new complete project");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn files_not_selected_by_user_are_rejected_before_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("unselected.pcraft");
        assert!(checked_path(&path, |_| false).is_err());
        assert!(!path.exists());
        assert!(checked_path(Path::new("relative.pcraft"), |_| true).is_err());
        assert_eq!(
            checked_path(&path, |_| true).unwrap(),
            dir.path().canonicalize().unwrap().join("unselected.pcraft")
        );
    }
    #[cfg(unix)]
    #[test]
    fn saves_follow_authorized_symlinks_and_preserve_readonly_files() {
        use std::os::unix::{fs::symlink, fs::PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        replace(&target, b"old").unwrap();
        let link = dir.path().join("link");
        symlink(&target, &link).unwrap();
        let resolved = checked_path(&link, |_| true).unwrap();
        replace(&resolved, b"updated").unwrap();
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&link).unwrap(), b"updated");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o400)).unwrap();
        assert!(replace(&target, b"bad").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"updated");
    }
}
