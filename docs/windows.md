# LocalTerm 1.5.5 — Windows

A LocalTerm helyi SSH-kliens. A hostokat, jelszavakat, privát kulcsokat, kulcsjelszavakat, ugróhostokat, snippeteket, porttovábbításokat és beállításokat egy szabadon elhelyezhető, jelszóval titkosított `.ltvault` fájlban tárolja. Nem szükséges hozzá LocalTerm-fiók.

## Képernyőkép

![LocalTerm főnézet — hostok, kereső és csoportok](images/localterm-hosts.jpg)

A közös alkalmazásfelület macOS-en, mintahostokkal. A Windows README ugyanazt a képernyőképet használja.

## Indítás és frissítés

- [LocalTerm-1.5.5-Windows-x64-Portable.exe](https://github.com/x0r3n/LocalTerm/releases/download/v1.5.5/LocalTerm-1.5.5-Windows-x64-Portable.exe): önálló portable futtatható fájl. Nem telepítő; indításkor kibontja és futtatja az alkalmazást.
- [LocalTerm-1.5.5-Windows-x64.zip](https://github.com/x0r3n/LocalTerm/releases/download/v1.5.5/LocalTerm-1.5.5-Windows-x64.zip): bontsd ki teljes egészében, majd indítsd a `LocalTerm.exe` fájlt. A mellette lévő fájlokat és mappákat hagyd a helyükön.

Intel/AMD 64 bites Windowsra készült; külön Windows ARM-csomag nincs. Node.js vagy Electron telepítése nem szükséges. Frissítés előtt zárd be a régi alkalmazást. A saját vault külön fájl marad. A kiadás nincs digitálisan aláírva.

## Gyorsbillentyűk

| Billentyű | Művelet |
|---|---|
| Ctrl+T | Új fül hostkeresővel |
| Ctrl+K | Kereső fókuszálása |
| Ctrl+R | Vissza az utolsó terminálhoz |
| Escape | Hostválasztó bezárása / húzás megszakítása |

## Használat

1. **Create a new vault**: válassz legalább 12 karakteres jelszót, majd fájlhelyet. Meglévő fájlhoz **Choose a vault file…**, majd **Unlock vault**.
2. **Keys**: privát kulcs hozzáadása vagy importálása. Az import a kulcs tartalmát a titkosított vaultba másolja.
3. **Hosts → New host**: név, szervercím, port, felhasználónév és jelszó vagy privát kulcs. Igény szerint csoport és rendezett ugróhostlista is megadható. Az ugróhostválasztó kereshető és betűrendbe rendezett.
4. **Connect**: első csatlakozáskor ellenőrizd a szerver ujjlenyomatát megbízható forrásból. Megváltozott ujjlenyomatnál a kapcsolat blokkolva van.
5. A **Save changes** az aktív titkosított fájlba ment. Újraindításkor az utolsó sikeresen megnyitott vault útvonala megmarad; a jelszót ismét meg kell adni.

## Terminálok és fájlkezelés

- Új terminál külön fülön, teljes területen nyílik. A kereshető új fülről további host választható.
- Egérrel húzd a fület vagy a panel fogantyúját egy másik terminál szélére osztáshoz. Az együtt megjelenített terminálok közös **Workspace** fület kapnak; a többi terminál külön fülön marad.
- Legfeljebb hat panel használható vegyes vízszintes és függőleges elrendezésben. A **Layout** menü egyenlő oszlopokat is kínál.
- Terminál bezárásakor a megmaradó panelek kitöltik a helyet; egyetlen panel teljes méretre nő. A távoli `exit` vagy `Ctrl+D` által lezárt munkamenet füle automatikusan bezárul.
- Jobb kattintás a terminál fülén → **Duplicate**: új, független kapcsolat ugyanahhoz a mentett hosthoz.
- **Workspace**: visszalépés a hostokhoz. A felső **Return to session** gomb visszavisz az utoljára kijelölt terminálhoz.
- **Browse files**: SFTP-listázás, feltöltés és letöltés. Távoli fájl felülírása előtt megerősítést kér.
- **Snippets**: elmenthető, újra használható parancsok.
- A **Hosts** megnyitásakor a **Search hosts** mező automatikusan fókuszt kap.

## Porttovábbítás és ugróhostok

**Port forwarding → New forwarding rule**: Local, Remote vagy Dynamic (SOCKS5) típus, SSH-host, figyelő cím/port, szükség szerint célcím/port. Mentés után **Start**, leállításhoz **Stop**. A szabályok a vaultban tárolódnak; a futó alagutak önálló SSH-kapcsolatot használnak.

A host szerkesztőjében állítsd össze a **Jump hosts (in connection order)** listát. Minden ugrás saját hitelesítést és szerverujjlenyomat-ellenőrzést kap. A célcímet az előző SSH-szerver oldja fel. Terminál, SFTP és mindhárom porttovábbítás ugyanazt az útvonalat használja. A célhosttal együtt legfeljebb nyolc SSH-host lehet az útvonalon; körkörös vagy hiányzó hivatkozás nem menthető.

## Vault settings

- **Automatic vault locking**: az automatikus zárolás főkapcsolója; 1–1440 perces inaktivitási idő; külön képernyőzár- és alvómód-kapcsoló. **Save locking settings** azonnal alkalmazza és a titkosított vaultba menti a választást. Alapból minden bekapcsolt, az időkorlát 15 perc. Kikapcsolt főkapcsolónál képernyőzár és alvó mód sem zárolja a vaultot. A kézi **Lock vault** és az alkalmazásból kilépés továbbra is zárol és bontja a kapcsolatokat.
- **Import from another encrypted vault…**: egy másik LocalTerm `.ltvault` bejegyzéseinek összevonása. A forrás jelszava szükséges; import előtt a cél mellett titkosított biztonsági másolat készül.
- **Save an encrypted copy as…**: külön másolat. Az aktív fájl marad az eredeti; a másolatot külön kell megnyitni használatához.
- **Open another vault…**: másik vault megnyitása.
- **Change password**: az aktív vault jelszavának cseréje. Régebbi másolatok jelszava nem változik.

A beépített importáló titkosított LocalTerm-vaultokat fogad.

## Titkosítás és mentés

AES-256-GCM, scrypt jelszószármaztatással (`N=65536, r=8, p=1`), 32 bájtos véletlen sóval, mentésenként új 12 bájtos nonce-szal és 16 bájtos hitelesítési taggel. A vault jelszava nem kerül mentésre. Feloldáskor az adatok a memóriában hozzáférhetők.

A mentés ideiglenes fájlt, fájlszinkronizálást és átnevezést használ. Észlelt külső módosítás esetén nem írja felül a fájlt. Ez nem többgépes zárolási protokoll. iCloud vagy más szinkronizált mappa esetén tartsd a fájlt letöltve, egyszerre egy gépen szerkeszd, és gépcsere előtt várd meg a szinkronizálást. Készíts biztonsági másolatot; elfelejtett jelszóhoz nincs helyreállítási szolgáltatás.

Az alkalmazás a legutóbb használt vault útvonalát az adott gép alkalmazásadat-mappájában tartja meg, a jelszót nem. A macOS és Windows vaultformátuma azonos.

## Fejlesztés

JavaScript / CommonJS, Electron, xterm.js és ssh2. Node.js 22 vagy újabb és npm szükséges a fejlesztéshez; a kész alkalmazáshoz nem.

```sh
npm ci
npm test
npm start
```

Az SSH-integrációs tesztek helyi TCP-portokat nyitnak. A tesztadatok szintetikusak. A `package-lock.json` rögzíti a függőségeket. A `src/` a teljes alkalmazásforrás, a `test/` az automatizált tesztek, a `releases/1.5.5/` a kész kiadás.

## Korlátok és ellenőrzés

Mosh, soros port, SSH-agent/FIDO2 és keyboard-interactive MFA nincs megvalósítva. Az Ed25519 kulcs OpenSSH formátumban támogatott; Ed25519 PPK helyett PuTTYgenből OpenSSH formátumot exportálj.

Az 1.5.4 érintett ellenőrzésein 52 teszt sikeres macOS-en, beleértve a zárolási szabályokat, a felületet és a titkosított mentést. A Mac felületén a zárolási idő mentését és visszatöltését is ellenőriztük. A kiadási ZIP-ek sértetlenségét és a csomagolt forrás egyezését ellenőriztük. Windows-futtatási környezetben ez a kiadás még nem volt tesztelve. Független biztonsági audit nem készült.

## Windows build készítése

```sh
npm run build:win
```

Windows x64 ZIP és portable EXE készül a `dist/` mappában. A kiadott csomag macOS-en, a Windows Electron-futtatókörnyezetével készült. Az opcionális natív SSH-gyorsító modulok kimaradnak a Windows-csomagból; a hordozható SSH-megvalósítás használatos.

A kész csomagok SHA-256 ellenőrzőösszegei: [`releases/1.5.5/SHA256SUMS.txt`](https://github.com/x0r3n/LocalTerm/releases/download/v1.5.5/SHA256SUMS.txt).

## Licenc

Copyright © 2026 x0r3n. A jelenlegi LocalTerm-forráskód a **GNU General Public License 3.0** alatt érhető el, kizárólag a 3. verzió szerint (`GPL-3.0-only`). A teljes licencszöveg a [LICENSE](../LICENSE) fájlban, a szerzői jogi nyilatkozat a [COPYRIGHT](../COPYRIGHT) fájlban található.

A program használható, módosítható és továbbadható a GPL feltételei szerint. Továbbadáskor biztosítani kell a megfelelő forráskódhoz való hozzáférést és meg kell őrizni a szükséges jogi jelöléseket. A programra nincs garancia.

A külső függőségek saját licencei és szerzői jogi jelölései érvényben maradnak. A korábban MIT alatt kiadott források és kész 1.5.4-es csomagok MIT szerinti jogosultságait ez a változás nem vonja vissza. Az 1.5.5-ös kiadás GPL-licencű csomagokból áll. A GPL és a szerzői jogi nyilatkozat az alkalmazáscsomagban is megtalálható. A pontos forrás a kész csomagok mellett, a `releases/1.5.5/LocalTerm-1.5.5-source.zip` fájlban is elérhető.

## Külső futtatókörnyezet licencértesítői

A macOS-csomagban a `LocalTerm.app/Contents/Resources/LICENSE.electron.txt` és `LICENSES.chromium.html` fájlok tartalmazzák az Electron és a Chromium értesítőit. Windowson ugyanezek a fájlnevek a kibontott alkalmazás főmappájában találhatók. A LocalTerm saját GPL-licence külön, a `Resources/LICENSE` (macOS), illetve `resources/LICENSE` (Windows) fájlban marad. A külső összetevők eredeti licencszövegei változatlanul megmaradnak.

## Terminálvágólap (1.5.5)

A terminálban kijelölt szöveg azonnal a rendszer vágólapjára kerül. Jobb kattintás a terminál tartalmán beilleszti a vágólap szövegét abba a panelbe. A fülek jobb kattintásos Duplicate menüje változatlanul használható.

A funkció alapból bekapcsolt. Kikapcsolás: **Vault settings → Terminal clipboard → Copy selection and paste on right-click**, majd **Save clipboard settings**. A választás a titkosított vaultban megmarad, és minden nyitott terminálra azonnal érvényes. A megszokott billentyűs másolás és beillesztés továbbra is használható.

A beillesztés az xterm.js normál paste útvonalát használja, beleértve a távoli alkalmazás által bekapcsolt bracketed paste módot. Zárolt vaultba vagy közben bezárt terminálba függőben lévő beillesztés nem jut el. A vágólap a rendszer vágólapja, a rámásolt szöveget a vault zárolása nem törli.
