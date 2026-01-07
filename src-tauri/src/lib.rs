use tauri::Manager;
use tauri::path::BaseDirectory;
use std::fs;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn load_audio_asset(app: tauri::AppHandle, filename: String) -> Result<Vec<u8>, String> {
    // 1. Dev Mode Fallback: Check directly in the project folder
    #[cfg(debug_assertions)]
    {
        use std::path::PathBuf;

        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?;
        let mut dev_path = PathBuf::from(manifest_dir);
        // Adjusted for new structure: src-tauri/resources/audio
        dev_path.push("resources/audio");
        dev_path.push(&filename);
        
        if dev_path.exists() {
             return fs::read(&dev_path).map_err(|e| format!("Failed to read file from dev path {:?}: {}", dev_path, e));
        }
    }

    // 2. Production / Standard Resource Mode
    let maybe_paths = vec![
        format!("resources/audio/{}", filename), 
        format!("resources/{}", filename),       
        format!("audio/{}", filename),           
        filename.clone(), 
    ];

    for path_str in maybe_paths {
         match app.path().resolve(&path_str, BaseDirectory::Resource) {
            Ok(path) => {
                if path.exists() {
                     return fs::read(&path).map_err(|e| format!("Failed to read file at {:?}: {}", path, e));
                }
            },
            Err(_) => {},
         }
    }
    
    Err(format!("Could not find audio file {} in resources", filename))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, load_audio_asset])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
