# Dynova Lager

Lagerverwaltung für Team Dynova: Bauteile, eigene Boards, Werkzeug und Messgeräte. Jede Box hat einen QR-Code. Scannen, antippen, fertig.

Die App ist reines HTML/CSS/JS ohne Build und läuft auf GitHub Pages. Die Daten liegen im privaten Repo [`dynova-lager-data`](https://github.com/Dynova-Focus/dynova-lager-data) in `lager.json`. Diese Seite ist öffentlich, enthält aber keine Daten. Ohne gültigen Schlüssel sieht man nur den Login.

## Einrichten (einmal pro Person und Gerät)

1. In der App auf **Schlüssel auf GitHub erstellen** tippen
2. Resource owner: `Dynova-Focus`
3. Repository access: *Only select repositories* → `dynova-lager-data`
4. Permissions → Repository → **Contents: Read and write**
5. Schlüssel kopieren und in der App einfügen

Der Schlüssel bleibt im Browser gespeichert und läuft nach spätestens einem Jahr ab.

## Bedienung

- **Material** (Widerstände, Stecker, Kabel) hat einen Füllstand: Voll, Knapp oder Leer. Alles Knappe landet unter *Bestellen*.
- **Einzelstücke** (Boards, Werkzeug, Messgeräte) werden mit *Nehmen* und *Zurück* ausgeliehen und haben ein Logbuch.
- Jede Änderung ist ein Commit im Daten-Repo mit Name und Uhrzeit.
- Unter *Mehr → Etiketten* lassen sich die QR-Codes drucken.

## Lokal testen

Mit VS Code Live Server `index.html` öffnen. Die App spricht auch lokal mit den echten Daten.

## Org-Einstellungen (einmalig, Org-Owner)

- *Settings → Personal access tokens*: fine-grained Tokens erlauben. Wenn *Require approval* aktiv ist, muss jeder neue Schlüssel unter *Pending requests* freigegeben werden.
- Alle Teammitglieder brauchen **Write**-Zugriff auf `dynova-lager-data`, am einfachsten über ein Team.
- In diesem Repo *Settings → Pages*: Deploy from branch `main`, Ordner `/ (root)`.
