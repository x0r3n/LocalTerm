# LocalTerm 1.5.5

Helyi SSH-kliens macOS-re és Windowsra, hordozható, jelszóval titkosított vaulttal. A közös forrás ebben a repóban található; a kész alkalmazások külön platformmappákban vannak.

![LocalTerm főnézet mintahostokkal](docs/images/localterm-hosts.jpg)

## Letöltés

| Platform | Kész csomag |
|---|---|
| macOS / Apple Silicon | [Mac ZIP](builds/macos/1.5.5/LocalTerm-1.5.5-Mac-AppleSilicon.zip) |
| Windows / Intel–AMD x64 | [Portable EXE](builds/windows/1.5.5/LocalTerm-1.5.5-Windows-x64-Portable.exe) · [Teljes ZIP](builds/windows/1.5.5/LocalTerm-1.5.5-Windows-x64.zip) |

A fájl oldalán a **Download raw file** gombbal töltsd le a csomagot. A kész alkalmazásokhoz nem szükséges Node.js vagy Electron telepítése. SHA-256 ellenőrzőösszegek: [SHA256SUMS.txt](SHA256SUMS.txt).

Telepítés, macOS-karanténjelölés kezelése és részletes használat: [macOS útmutató](docs/macos.md) · [Windows útmutató](docs/windows.md).

## Funkciók

- Hostok, csoportok, jelszavak, privát kulcsok és snippetek egy titkosított `.ltvault` fájlban.
- SSH, kereshető terminálfülek és egérrel elrendezhető osztott Workspace-nézetek.
- SFTP-listázás, feltöltés és letöltés; Local, Remote és Dynamic/SOCKS5 porttovábbítás.
- Többlépcsős ugróhostok, hostujjlenyomat-ellenőrzés és az utolsó vaultútvonal megjegyzése.
- Állítható automatikus zárolás, külön képernyőzár- és alvómód-kapcsolókkal.
- **1.5.5:** a terminál kijelölése automatikusan másol, a jobb kattintás a kattintott panelbe illeszt. Alapból bekapcsolt; kikapcsolás a **Vault settings → Terminal clipboard** résznél, majd **Save clipboard settings**. A beállítás a titkosított vaultban megmarad.

A Macen és Windowson használt vaultformátum azonos. AES-256-GCM titkosítás és scrypt jelszószármaztatás használatos. A vault jelszava nem kerül mentésre. Szinkronizált mappában is használható a helyi fájl, de egyszerre csak egy gépen szerkeszd, és készíts biztonsági másolatot.

## A repó felépítése

```text
src/                       Közös alkalmazásforrás
test/                      Automatizált tesztek
docs/macos.md              Mac telepítés és használat
docs/windows.md            Windows telepítés és használat
builds/macos/1.5.5/         Mac build (Git LFS)
builds/windows/1.5.5/       Windows buildek (Git LFS)
releases/1.5.5/             Teljes forrásarchívum
```

A nagy buildfájlok Git LFS-ben vannak. Klónozáshoz telepítsd a [Git LFS-t](https://git-lfs.com/), majd:

```sh
git lfs install
git clone git@github.com:x0r3n/LocalTerm.git
cd LocalTerm
git lfs pull
```

A GitHub automatikus **Download ZIP** forrásletöltésében a buildek helyett LFS-hivatkozások lehetnek. A kész alkalmazást a fenti platformlinkről, a teljes forrást a [külön forráscsomagból](releases/1.5.5/LocalTerm-1.5.5-source.zip) töltsd le.

## Fejlesztés és build

JavaScript/CommonJS, Electron, xterm.js és ssh2. Node.js 22 vagy újabb, valamint npm szükséges:

```sh
npm ci
npm test
npm start
npm run build       # macOS Apple Silicon Macen
npm run build:win   # Windows x64 ZIP és portable EXE
```

A csomagok a `dist/` mappába kerülnek. Az SSH-integrációs tesztek helyi TCP-portokat használnak. Az 1.5.5 kiadásnál 65 teszt sikeres macOS-en; a kijelöléses másolást, jobb kattintásos beillesztést és a kapcsolót natív Mac-felületen, szintetikus SSH-szerverrel is ellenőriztük. Windows-futtatási környezetben ez a kiadás még nem volt tesztelve. A kiadások nincsenek digitálisan aláírva; a Mac-build nincs notarizálva.

## Licenc

Copyright © 2026 **x0r3n**. A LocalTerm [GNU GPL 3.0, kizárólag a 3. verzió szerint](LICENSE) (`GPL-3.0-only`) használható. A szerzői jogi nyilatkozat a [COPYRIGHT](COPYRIGHT) fájlban van. A programra nincs garancia. A külső függőségek eredeti licencei és copyright-értesítői megmaradnak; a csomagok tartalmazzák az Electron és Chromium licencértesítőit is.

A korábban MIT alatt kiadott példányokra kapott jogosultságokat a GPL-re váltás nem vonja vissza.
