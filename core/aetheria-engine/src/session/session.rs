//! Session data model, persistent store & run lifecycle.
#[cfg(not(test))]
use crate::paths::aetheria_data_dir;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionStoreData {
    #[serde(default)]
    pub sessions: HashMap<String, Value>,
    #[serde(default)]
    pub messages: HashMap<String, Vec<Value>>,
}

static SESSION_STORE: OnceLock<Mutex<SessionStoreData>> = OnceLock::new();
pub static ACTIVE_RUNS: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();

pub fn store_file_path() -> PathBuf {
    #[cfg(test)]
    {
        static TEST_STORE_DIR: OnceLock<PathBuf> = OnceLock::new();
        let dir = TEST_STORE_DIR.get_or_init(|| {
            let p = std::env::temp_dir()
                .join(format!("aetheria-test-store-{}", std::process::id()));
            let _ = std::fs::create_dir_all(&p);
            p
        });
        return dir.join("sessions-store.json");
    }
    #[cfg(not(test))]
    {
        aetheria_data_dir().join("sessions-store.json")
    }
}

pub fn load_store_from(p: &std::path::Path) -> SessionStoreData {
    let bak = p.with_extension("json.bak");
    for candidate in [p, bak.as_path()] {
        if let Ok(raw) = std::fs::read_to_string(candidate) {
            if let Ok(parsed) = serde_json::from_str::<SessionStoreData>(&raw) {
                if !parsed.sessions.is_empty() || !parsed.messages.is_empty() {
                    return parsed;
                }
            }
        }
    }
    SessionStoreData::default()
}

pub fn load_store() -> SessionStoreData {
    let p = store_file_path();
    let loaded = load_store_from(&p);
    if !loaded.sessions.is_empty() || !loaded.messages.is_empty() {
        return loaded;
    }
    #[cfg(test)]
    return SessionStoreData::default();

    #[cfg(not(test))]
    {
        // Auto-migrate from SQLite Aetheria-local.db if available
        let db_path = aetheria_data_dir().join("Aetheria-local.db");
        if db_path.exists() {
            let mut migrate_cmd = std::process::Command::new("bun");
            crate::paths::configure_hidden_std_command(&mut migrate_cmd);
            let _ = migrate_cmd
                .arg("scripts/migrate-sqlite-to-json.cjs")
                .output();
            if let Ok(raw) = std::fs::read_to_string(&p) {
                if let Ok(parsed) = serde_json::from_str::<SessionStoreData>(&raw) {
                    if !parsed.sessions.is_empty() || !parsed.messages.is_empty() {
                        return parsed;
                    }
                }
            }
        }
        SessionStoreData::default()
    }
}

pub fn save_store_raw_to(p: &std::path::Path, raw: &str) {
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = p.with_extension(format!("json.tmp.{}", std::process::id()));
    let bak = p.with_extension("json.bak");
    let write_ok = (|| -> std::io::Result<()> {
        std::fs::write(&tmp, raw.as_bytes())?;
        if p.exists() {
            let _ = std::fs::remove_file(&bak);
            let _ = std::fs::rename(p, &bak);
        }
        if let Err(err) = std::fs::rename(&tmp, p) {
            if !p.exists() && bak.exists() {
                let _ = std::fs::rename(&bak, p);
            }
            return Err(err);
        }
        Ok(())
    })();
    if write_ok.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

pub fn save_store_to(p: &std::path::Path, store: &SessionStoreData) {
    if let Ok(raw) = serde_json::to_string(store) {
        save_store_raw_to(p, &raw);
    }
}

fn enqueue_background_store_write(p: PathBuf, raw: String) {
    static WRITER_SLOT: OnceLock<std::sync::Arc<(Mutex<Option<(PathBuf, String)>>, std::sync::Condvar)>> =
        OnceLock::new();
    let pair = WRITER_SLOT.get_or_init(|| {
        let shared = std::sync::Arc::new((
            Mutex::new(None::<(PathBuf, String)>),
            std::sync::Condvar::new(),
        ));
        let worker_shared = std::sync::Arc::clone(&shared);
        let _ = std::thread::Builder::new()
            .name("aetheria-session-persist".to_string())
            .spawn(move || {
                let (lock, cv) = &*worker_shared;
                loop {
                    let next_item = {
                        let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
                        while guard.is_none() {
                            guard = cv.wait(guard).unwrap_or_else(|e| e.into_inner());
                        }
                        guard.take()
                    };
                    if let Some((path, payload)) = next_item {
                        save_store_raw_to(&path, &payload);
                    }
                }
            });
        shared
    });
    let mut guard = pair.0.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some((p, raw));
    pair.1.notify_one();
}

pub fn save_store(store: &SessionStoreData) {
    if let Ok(raw) = serde_json::to_string(store) {
        enqueue_background_store_write(store_file_path(), raw);
    }
}

pub fn with_store<F, R>(f: F) -> R
where
    F: FnOnce(&mut SessionStoreData) -> R,
{
    let m = SESSION_STORE.get_or_init(|| Mutex::new(load_store()));
    let mut guard = m.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut guard)
}

pub fn set_active_run(session_id: &str, running: bool) {
    let m = ACTIVE_RUNS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = m.lock().unwrap_or_else(|e| e.into_inner());
    if running {
        guard.insert(session_id.to_string(), true);
    } else {
        guard.remove(session_id);
    }
}

pub fn is_active_run(session_id: &str) -> bool {
    let m = ACTIVE_RUNS.get_or_init(|| Mutex::new(HashMap::new()));
    let guard = m.lock().unwrap_or_else(|e| e.into_inner());
    guard.get(session_id).copied().unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_and_load_store_recovers_from_backup_when_primary_corrupt() {
        let tmp_dir = std::env::temp_dir().join(format!(
            "aetheria_session_store_bak_{}",
            crate::paths::now_ms()
        ));
        std::fs::create_dir_all(&tmp_dir).expect("create temp dir");
        let p = tmp_dir.join("sessions-store.json");
        let bak = p.with_extension("json.bak");

        let mut data = SessionStoreData::default();
        data.sessions.insert("s_test".to_string(), serde_json::json!({ "id": "s_test" }));
        save_store_to(&p, &data);
        data.sessions.insert("s_test_2".to_string(), serde_json::json!({ "id": "s_test_2" }));
        save_store_to(&p, &data);

        assert!(bak.exists(), "backup file should exist after second save");
        std::fs::write(&p, "{corrupted json").expect("corrupt primary");
        let recovered = load_store_from(&p);
        assert!(recovered.sessions.contains_key("s_test"));
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}

