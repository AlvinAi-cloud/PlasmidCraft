//! Native window, menus, and user-selected file access. Biology stays in JavaScript.
mod ai;
mod ai_vault;
mod blast;
mod chatgpt;
mod files;

use tauri::{
    menu::{AboutMetadata, Menu, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    App, Emitter, Manager, RunEvent,
};

fn application_menu(app: &App) -> tauri::Result<Menu<tauri::Wry>> {
    let about = PredefinedMenuItem::about(
        app,
        Some("About PlasmidCraft"),
        Some(AboutMetadata {
            name: Some("PlasmidCraft".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            copyright: Some("© 2026 PlasmidCraft contributors · MIT license".into()),
            authors: Some(vec!["Huiwang Ai · University of Virginia".into()]),
            comments: Some("Prepared by Huiwang Ai at the University of Virginia with ChatGPT Codex. Contact: huiwang.ai@virginia.edu".into()),
            ..Default::default()
        }),
    )?;
    #[cfg(target_os = "macos")]
    let application = SubmenuBuilder::new(app, "PlasmidCraft")
        .item(&about)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        // A custom quit routes through the same unsaved-document guard as window close.
        .item(&MenuItem::with_id(
            app,
            "quit",
            "Quit PlasmidCraft",
            true,
            Some("CmdOrCtrl+Q"),
        )?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&MenuItem::with_id(
            app,
            "open",
            "Open Sequence…",
            true,
            Some("CmdOrCtrl+O"),
        )?)
        .text("paste", "New from Pasted DNA…")
        .text("paste-protein", "New from Pasted Protein…")
        .text("extract-dna", "New DNA from Selection…")
        .separator()
        .item(&MenuItem::with_id(
            app,
            "save-project",
            "Save PlasmidCraft Document",
            true,
            Some("CmdOrCtrl+S"),
        )?)
        .item(&MenuItem::with_id(
            app,
            "save-project-as",
            "Save PlasmidCraft Document As…",
            true,
            Some("CmdOrCtrl+Shift+S"),
        )?)
        .separator()
        .text("export-genbank", "Export GenBank…")
        .text("export-snapgene", "Export SnapGene format…")
        .text("export-fasta", "Export FASTA…")
        .text("export-svg", "Export Map SVG…")
        .separator()
        .item(&MenuItem::with_id(
            app,
            "close-document",
            "Close Document",
            true,
            Some("CmdOrCtrl+W"),
        )?);
    #[cfg(not(target_os = "macos"))]
    let file = file.separator().item(&MenuItem::with_id(
        app,
        "quit",
        "Exit PlasmidCraft",
        true,
        Some("Alt+F4"),
    )?);
    let file = file.build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .text("undo-annotation", "Undo Last Change")
        .text("redo-annotation", "Redo Last Change")
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .text("add-feature", "Add Feature…")
        .text("edit-feature", "Edit Selected Feature…")
        .separator()
        .text("edit-dna", "Insert, Replace or Delete DNA…")
        .text("reverse-dna", "Reverse Complement DNA…")
        .text("set-origin", "Set Circular Origin…")
        .separator()
        .text("copy-sequence", "Copy Selected Sequence…")
        .text("copy-reverse", "Copy Reverse Complement")
        .item(&MenuItem::with_id(
            app,
            "find",
            "Find DNA or Annotation…",
            true,
            Some("CmdOrCtrl+F"),
        )?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .text("view-map", "Map")
        .text("view-sequence", "Sequence")
        .text("view-features", "Feature List")
        .text("view-primers", "Primer List")
        .text("view-enzymes", "Restriction Sites")
        .separator()
        .text("toggle-features", "Show/Hide Features")
        .text("toggle-primers", "Show/Hide Primer Binding Sites")
        .text("toggle-enzymes", "Show/Hide Unique Sites on Map")
        .separator()
        .text("layout-circular", "Circular Map")
        .text("layout-linear", "Linear Map")
        .separator()
        .text("toggle-files", "Show/Hide Open Documents")
        .text("toggle-inspector", "Show/Hide Selection Inspector")
        .build()?;
    let tools = SubmenuBuilder::new(app, "Tools")
        .text("feature-libraries", "Feature Libraries…")
        .text("auto-annotation", "Auto Annotation…")
        .separator()
        .text("design-primers", "Primer Design…")
        .text("create-selection-primer", "Primer from Selected DNA…")
        .text("design-mutagenesis", "Mutagenic Primer Design…")
        .text("simulate-pcr", "Simulate PCR…")
        .separator()
        .text("align-reads", "Align Sanger / DNA Reads…")
        .text("compare-plasmids", "Align Whole Plasmids…")
        .text("read-consensus", "Read Assembly and Consensus…")
        .separator()
        .text("assembly-workbench", "Cloning and Assembly…")
        .text("design-gibson", "Design Gibson Cloning…")
        .text("design-golden", "Design Golden Gate Cloning…")
        .separator()
        .text("protein-documents", "Protein Documents / Protein to DNA…")
        .text("optimize-codons", "Optimize Selected CDS Codons…")
        .text("protein-analysis", "Protein Analysis…")
        .text("blast", "NCBI BLAST…")
        .text("coding-proteins", "Coding Feature Proteins…")
        .text("find-orfs", "Find Open Reading Frames…")
        .text("view-translation", "Six-frame Translation…")
        .separator()
        .text("view-enzymes", "Restriction Analysis…")
        .text("go-to", "Go to Bases…")
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .text("window-minimize", "Minimize")
        .text("window-maximize", "Toggle Maximize")
        .text("window-fullscreen", "Toggle Full Screen")
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .text("help", "Getting Started")
        .text("help-guide-getting-started", "User Guide and Search…")
        .text("help-guide-mutagenesis", "Mutagenic Primers")
        .text("help-guide-alignment", "Editing and Alignment")
        .text("help-guide-pcr", "PCR and Assembly")
        .text("help-guide-cloning", "Gibson / HiFi and Golden Gate")
        .text("help-guide-codons", "Codon Optimization")
        .text("help-guide-protein", "Protein Analysis and BLAST")
        .text("help-guide-features", "Feature Libraries and File Formats")
        .text("help-guide-ai", "AI Connections and Operations")
        .separator()
        .text("workflow-examples", "Load Workflow Examples");
    #[cfg(not(target_os = "macos"))]
    let help = help.separator().item(&about);
    let help = help.build()?;

    let ai = SubmenuBuilder::new(app, "AI")
        .text("ai-assistant", "Internal AI Operations…")
        .text("ai-external", "External AI…")
        .separator()
        .text("ai-settings", "Accounts and Models…")
        .build()?;
    let menu = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let menu = menu.item(&application);
    menu.items(&[&file, &edit, &view, &tools, &ai, &window, &help])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ai::AiState::default())
        .manage(blast::BlastState::default())
        .invoke_handler(tauri::generate_handler![
            files::save_file_atomic,
            blast::blast_submit,
            blast::blast_open_results,
            ai::ai_connect,
            ai::ai_list_models,
            ai::ai_disconnect,
            ai::ai_restore_saved,
            ai::ai_forget_saved,
            ai::ai_cancel,
            ai::ai_request,
            ai::ai_open_site,
            chatgpt::chatgpt_status,
            chatgpt::chatgpt_restore,
            chatgpt::chatgpt_sign_in,
            chatgpt::chatgpt_cancel,
            chatgpt::chatgpt_activate,
            chatgpt::chatgpt_models,
            chatgpt::chatgpt_sign_out
        ])
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            app.manage(chatgpt::ChatGptState::new(
                app.path().app_config_dir()?.join("chatgpt"),
            ));
            app.set_menu(application_menu(app)?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            // These predefined menu actions are unsupported on some platforms.
            // Call Tauri's window API directly for consistent desktop behavior.
            match event.id().as_ref() {
                "window-minimize" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.minimize();
                    }
                }
                "window-maximize" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_maximized().unwrap_or(false) {
                            let _ = window.unmaximize();
                        } else {
                            let _ = window.maximize();
                        }
                    }
                }
                "window-fullscreen" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
                    }
                }
                action => {
                    let _ = app.emit("plasmidcraft-menu", action);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("PlasmidCraft could not start");
    app.run(|handle, event| {
        // Dock/system Quit must use the same unsaved-change check as the window.
        // Once the main window has been destroyed, allow the process to exit.
        if let RunEvent::ExitRequested { api, .. } = event {
            if handle.get_webview_window("main").is_some() {
                api.prevent_exit();
                let _ = handle.emit("plasmidcraft-menu", "quit");
            }
        }
    });
}
