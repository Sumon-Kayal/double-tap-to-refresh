# Building on Windows

Part of [BUILDING.md](../../BUILDING.md). **Not run on Windows yet:** this page is written from what the scripts need, so tell
us if a step fails.

The scripts are written for `bash` and GNU tools, which Windows does not have, so build inside WSL (Windows Subsystem for
Linux). PowerShell, `cmd` and Git Bash are not supported: Git Bash does not ship `zip` by default, and the Python signing
tests look for `python3`.

## 1. Install WSL with Ubuntu

In PowerShell, run:

```powershell
wsl --install -d Ubuntu
```

Restart if Windows asks, then open **Ubuntu** from the Start menu and create a user name and password.

## 2. Install the tools and build

Inside the Ubuntu window, follow the [Ubuntu section of the Linux guide](linux.md#ubuntu) and then
[Build and test](linux.md#build-and-test). In short:

```sh
sudo apt update
sudo apt install git zip unzip python3 nodejs
git clone https://github.com/Sumon-Kayal/double-tap-to-refresh.git
cd double-tap-to-refresh
bash scripts/build.sh
node --test
```

Clone into your Linux home folder (as above), not under `/mnt/c`: the Windows drive is slow from WSL and does not keep Unix
file modes.

## 3. Try it in a Windows browser

From Windows, the Linux folders are reachable at `\\wsl.localhost\Ubuntu\home\<your user name>\double-tap-to-refresh`.

- **Chrome, Edge, Brave:** open `chrome://extensions`, turn on Developer mode, choose Load unpacked and pick the `chromium`
  folder at that path.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on and pick `firefox\manifest.json` at
  that path.
