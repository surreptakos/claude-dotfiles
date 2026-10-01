---
name: windowsapps-python-hides-appdata-npm
description: "On AAC-AI, py and python3 are Python Install Manager aliases in WindowsApps; Python started through them, and its children, cannot see the Roaming npm directory, so npm CLIs such as agent-browser look uninstalled"
metadata:
  type: project
---

On AAC-AI (2026-10-01), `py.exe`, `python3.exe` and `python.exe` in `%LOCALAPPDATA%\Microsoft\WindowsApps` are aliases of the Python Install Manager package. A Python started through one of them sees a virtualized AppData: `os.path.isdir(%APPDATA%\npm)` is False, `shutil.which("agent-browser")` is None, and a `bash` or `cmd` child it spawns cannot find the CLI either. The same interpreter started by its real path (`%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe`, or `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`) sees the directory. The environment variables are identical, and `GetCurrentPackageFullName` reports no package in both, so neither check detects the case. The brazil-flights garden routine skipped its Google Flights check for this reason and reported "agent-browser not installed here" (surreptakos/brazil-flights#10).

**Why:** a script's "not installed" message describes what its process can see, not what is on disk.

**How to apply:** a script that calls an npm global CLI from Python runs under a `python.exe` resolved outside WindowsApps: `Get-Command python.exe -All` and take the first `Source` not under `\WindowsApps\`. In Git Bash, `python` resolves to the Python312 install first and works; `py` does not. Since 2026-10-01 AAC-AI has the "Python (default)" python.exe and python3.exe execution aliases turned Off (Settings, Apps, Advanced app settings, App execution aliases), so `python3` falls through to `%LOCALAPPDATA%\Python\bin\python3.exe` and sees the npm directory in both Git Bash and PowerShell. Keep the py.exe alias On: the governance hooks call `py -3` every turn and no other py.exe exists. A new machine keeps the aliases On until someone turns them off. Also, a PowerShell or Task Scheduler PATH has no `bash`, so a Python script that shells out to bash needs Git's `bin` directory added. Related: [[ps51-scripts-need-a-bom]].

Source: https://github.com/surreptakos/brazil-flights/pull/11, https://github.com/surreptakos/brazil-flights/pull/12
