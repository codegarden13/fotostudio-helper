#  fotostudio-helper (MacOS, Linux)

*Solid Photo Storage workflow app (Für Agenturen, Fotografen, Studios)*

Du hast *verschiedene Kameras und Handys*, die Bilder bei *verschiedenen Cloudanbietern* speichern. Oder Du bekommst Ordner mit Bildern von *irgendwem* und *über igendwas*. Das kann man zentralisieren.

'fotostudio-helper' ist mein erster Workflow dahingehend vor jeglichen "Edits" - oder nur, um Bilder diverser Quellen kompatibel zu Agenturen, Editoren wie Lightroom oder Photoshop und Bilddatenbanken abzulegen (Industriestandard IPTC/XMP 'Sidecars')

<p align="center">
  <img src="./assets/logo.png" alt="Illustration fotostudio-helper" width="100%">

</p>

<p align="center">No matter how you switch photo devices: Your sessions are captured.</p>

## Features

### Skalierbare Langzeitarchivierung
- **Software-agnostisch:** keine Bindung an ein bestimmtes Bildbearbeitungs- oder Asset-Management-System  
- Einheitliche, stabile Ordnerstruktur als langfristige "Quelle der Wahrheit"

### Präsentation von Fotosessions beim Kunden
- Interaktives Session-Shaping in Echtzeit
- Datengetriebener Zeit-Gap-Slider: reale Aufnahmeabstände bestimmen die Clusterung

### Einheitliche Ordnerstruktur für alle Kameras & Handys
- Bilder aller Geräte landen in **einer konsistenten Struktur**
- Logische Sessionnamen (Default: `<Target>/<YYYY>/<MM>/<YYYY-MM-DD Titel>`)
- Ziel-Volume und Root in der GUI änderbar

### Fotosession-Import
- Sessions werden werden nach den Scan **interaktiv** mittels Schieberegler "Zeitversatz" definiert und optional benannt
- Sessionnamen werden im Zielarchiv als Ordner sichtbar
- Sessionbilder werden in den Papierkorb gelegt
- Der Prozess wird in ein Logfile geschrieben

![alt text](assets/05_SerieBenennen.png)
Folgende Struktur entsteht im Ziel (NAS/Mountpoint):

<details>

```
└── 📁2026
    └── 📁01
        └── 📁2026-01-03 Moonshine Session 01__SonyA7R
            └── 📁exports
                └── 📁2026-01-03 Moonshine Session 01__SonyA7R
            └── 📁originals
                ├── SonyA7R__DSC05405.ARW
                ├── SonyA7R__DSC05406.ARW
                ├── SonyA7R__DSC05407.ARW
                ├── SonyA7R__DSC05408.ARW
            └── session.json
```

Basis des Ordnernamens ist der Datestamp des ersten Bildes der Session.

</details>

### Datenquellen-Integration

<details>

- Jeder **gemountete Datenträger** kann als Quelle dienen (Kamera, NAS, USB-Stick, ein Pfad auf Deinem Rechner.) 
- Die Konfiguration ist **Geräte- und workflow-spezifisch**
- Zusätzliche (Kamera) -Profile können selbst ergänzt (oder als Dienstleistung umgesetzt) werden  
 
- Aktueller Schwerpunkt: **Sony / Canon Kameras**

</details>


## Installation

<details>

- Node.js >= 18


```bash
git clone https://github.com/codegarden13/fotostudio-helper
cd studio-helper
npm install
```

</details>

Bei Bedarf: 

Sende mir *gerne* einen Serviceauftrag zur Implementierung in Deinem Studio mit Deinen Kameras 😊 - oder eine Tasse Kaffee !