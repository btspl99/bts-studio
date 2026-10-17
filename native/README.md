# Native helpers (Windows)

Small native programs and DLLs that the Electron app cannot provide by itself. Each lives in its own folder
with a `build-win.ps1` that is run on GitHub Actions (`windows-latest`, Visual Studio 2022) by
`native/build-all.ps1`, and writes its outputs to `vendor/native/win32-x64/<name>/`. The installer ships
them as `resources/native/<name>/`. Use the **Native test build** workflow (Actions → Run workflow) to
build one component from any branch.
