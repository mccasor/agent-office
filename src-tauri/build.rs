fn main() {
    // la versione dell'app viene da package.json (vedi tauri.conf.json): ricompila quando cambia
    println!("cargo:rerun-if-changed=../package.json");
    tauri_build::build()
}
