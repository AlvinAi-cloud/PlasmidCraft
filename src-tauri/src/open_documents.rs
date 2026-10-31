//! Only paths handed to the process by the OS are granted to the renderer.
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

#[derive(Default)]
pub struct OpenDocuments(Mutex<Vec<PathBuf>>);

fn supported(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "pcraft"
                    | "pcprotein"
                    | "gb"
                    | "gbk"
                    | "genbank"
                    | "fa"
                    | "fasta"
                    | "fna"
                    | "faa"
                    | "pep"
                    | "dna"
                    | "ab1"
            )
        })
}

pub fn enqueue(app: &tauri::AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let state = app.state::<OpenDocuments>();
    let mut pending = state.0.lock().unwrap_or_else(|e| e.into_inner());
    for path in paths {
        if !supported(&path) {
            continue;
        }
        // Keep failed paths too: the renderer displays the normal per-file error.
        // Relative command-line paths resolve before they cross the bridge.
        let path = if path.is_absolute() {
            path
        } else if let Ok(dir) = std::env::current_dir() {
            dir.join(path)
        } else {
            continue;
        };
        if !pending.contains(&path) {
            pending.push(path);
        }
    }
    drop(pending);
    let _ = app.emit("plasmidcraft-open-documents", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn startup(app: &tauri::AppHandle) {
    let paths = std::env::args_os().skip(1).filter_map(|arg| {
        let text = arg.to_string_lossy();
        if text.starts_with('-') {
            None
        } else if text.starts_with("file:") {
            tauri::Url::parse(&text).ok()?.to_file_path().ok()
        } else {
            Some(PathBuf::from(arg))
        }
    });
    enqueue(app, paths);
}

#[tauri::command]
pub fn take_open_documents(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let paths = std::mem::take(
        &mut *app
            .state::<OpenDocuments>()
            .0
            .lock()
            .map_err(|_| "Cannot read pending documents")?,
    );
    let scope = app.fs_scope();
    let mut result = Vec::new();
    for path in paths {
        scope.allow_file(&path).map_err(|e| e.to_string())?;
        // Canonical access is also needed when saving a project reached by symlink.
        if let Ok(real) = path.canonicalize() {
            scope.allow_file(&real).map_err(|e| e.to_string())?;
        }
        result.push(path.to_string_lossy().into_owned());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn associations_accept_supported_documents_only() {
        for ext in [
            "pcraft",
            "pcprotein",
            "GB",
            "gbk",
            "genbank",
            "fa",
            "fasta",
            "fna",
            "faa",
            "pep",
            "dna",
            "ab1",
        ] {
            assert!(supported(&PathBuf::from(format!("example.{ext}"))));
        }
        for name in ["notes.txt", "script.js", "unknown", "report.pdf"] {
            assert!(!supported(&PathBuf::from(name)));
        }
    }
}
