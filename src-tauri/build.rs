fn main() {
    println!("cargo:rerun-if-env-changed=INSPIRATION_DRAWER_SERVER_URL");
    println!("cargo:rerun-if-env-changed=INSPIRATION_DRAWER_SERVER_TOKEN");
    tauri_build::build()
}
