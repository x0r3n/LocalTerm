# LocalTerm 1.7.0

LocalTerm is a local SSH client for macOS and Windows with a portable, password-encrypted vault. No LocalTerm account is required.

![LocalTerm hosts and groups](docs/images/localterm-hosts.jpg)

## Download

Get the macOS Apple Silicon ZIP, Windows x64 portable EXE or Windows ZIP from [Release 1.7.0](https://github.com/x0r3n/LocalTerm/releases/tag/v1.7.0). The release includes source and SHA-256 checksums. The builds are unsigned; the Mac build is not notarized.

See the [macOS guide](docs/macos.md) and [Windows guide](docs/windows.md) for installation, shortcuts and usage.

## Features

- Encrypted `.ltvault` for hosts, credentials, private keys, snippets, forwarding rules and settings.
- Searchable SSH tabs, draggable split workspaces, duplicate sessions and per-host terminal themes.
- Two-pane SFTP with batch upload, download and delete; overwrite, rename or skip conflicts with an apply-to-all option. Copy supports regular files; delete supports files and empty folders.
- Local, remote and dynamic SOCKS5 forwarding, ordered jump hosts and host fingerprint checks.
- Configurable vault locking, terminal clipboard behavior and manual or daily update checks.

The same vault format works on both platforms. Use a synchronized vault on one device at a time and keep backups.

## Development

```sh
npm ci
npm test
npm start
npm run build       # macOS Apple Silicon
npm run build:win   # Windows x64 ZIP and portable EXE
```

Node.js 22+ and npm are required. Large binaries in `builds/` use Git LFS; GitHub's source ZIP may contain LFS pointers. The release includes a separate source archive. The 1.7.0 test suite passed 81 tests on macOS, including local SFTP integration tests; native Windows runtime testing remains outstanding.

## License

Copyright © 2026 x0r3n. Licensed under [GPL-3.0-only](LICENSE); see [COPYRIGHT](COPYRIGHT). There is no warranty. Third-party license notices, including Electron and Chromium notices, are included in the packages. Rights granted under earlier MIT-licensed versions remain valid.
