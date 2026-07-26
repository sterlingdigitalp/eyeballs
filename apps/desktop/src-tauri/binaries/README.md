# CaptureCore sidecar binaries

Tauri `externalBin` expects:

```text
capture-core-aarch64-apple-darwin
capture-core-x86_64-apple-darwin
```

Generate for this machine:

```sh
# from repo root
sh scripts/dev/prepare-capture-core-sidecar.sh
```

Do not commit the built binaries (they are gitignored). CI/release packaging
runs the prepare script before `tauri build`.
