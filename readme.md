#  fotostudio-helper [1.0.9]

Sessionbasierter, sauberer Import-Workflow für Fotosessions vor dem Edit. Bildverwaltung für Agenturen, Fotografen, Studios, Broadcast. *(Industry standards IPTC/XMP)* 


<p align="center">
  <img src="./assets/logo.png" alt="Illustration fotostudio-helper" width="100%">
</p>

<p align="center">No matter how you switch photo devices: Your work is captured. Save.</p>

## Usecases
**Photosessions zukunftssicher speichern, zur Weiterverarbeitung vorbereiten.** 

- **Privat**: Du willst Deine Bilder einfach besser sortieren.
- **Familie**: Du hast *Kameras und Handys*, die Bilder bei *verschiedenen Cloudanbietern* speichern. 
- **Dein Office**: Ordner mit Bildern von *irgendwem* und *über igendwas* wollen einsortiert werden. Du bekommst Ordner oder Archive mit Bildern, die ordentlich abgelegt werden wollen: **"The usual chaos"**.
- **Studio**Deine Photografen fotografieren mehrere Events gleichzeitig in der selben Woche, die Drohnen filmen irgendwo und die Handyshots "Behind the Stage" Deiner Mitarbeiter sind auch mega ...

**fotostudio-helper** skaliert auf >10000 Sessions monatlich, ist schnell wesentlich praxisbezogener als gängige Systeme, die Ordnerstrukturen wie  YYYY//MM/DD nutzen. 



## Unterstützte Dateitypen
- RAW:
  - `.arw`, `.cr2`, `.cr3`, `.nef`, `.raf`, `.dng`, `.rw2`, `.orf`, `.pef`, `.srw`
- Raster:
  - `.jpg`, `.jpeg`, `.tif`, `.tiff`


## Features

**fotostudio-helper** organisiert Bilder aus beliebigen Quellen automatisch in stabile, sessionbasierte Ordnerstrukturen.
RAWs, JPEGs und Sidecars (XMP, ON1, …) bleiben vollständig erhalten und kompatibel mit Lightroom, Capture One, Photoshop und Bilddatenbanken.

Sessions werden live anhand realer Aufnahmeabstände erkannt, interaktiv angepasst und mit Metadaten angereichert.
Das Ergebnis: ein zukunftssicheres Archiv als verlässliche Basis für alle weiteren Edit- und Exportprozesse

### Skalierbare Langzeitarchivierung
- **Software-agnostisch:** keine Bindung an ein bestimmtes Bildbearbeitungs- oder Asset-Management-System  
- Einheitliche, stabile Ordnerstruktur als langfristige "Quelle der Wahrheit"

Bilder aus beliebigen Quellen werden automatisch zu logischen Fotosessions gruppiert.
Grundlage ist der tatsächliche Aufnahmezeitpunkt – nicht Ordnernamen oder Geräte.
	•	Alle Bilder landen in einer konsistenten, nachvollziehbaren Struktur
	•	Sessions erhalten sprechende, stabile Namen
(Default: <Target>/<YYYY>/<MM>/<YYYY-MM-DD Titel__KAMERANAME>)
Sind mehrere Kameras beteiligt, wird der Suffix automatisch zu __MIXED
	•	Quelle (UI) und Ziel (Config) sind unabhängig konfigurierbar


![alt text](assets/05_SerieBenennen.png)

<details>

```
└── 📁2025
    └── 📁04
        └── 📁2025-04-17 Genua Hauptgang am Hafen__SONY ILCE-7RM5
            └── 📁exports
                └── 📁jpg
                └── 📁jpg-klein
                └── 📁tif
            └── 📁originals
                ├── SONY ILCE-7RM5__0890.arw
                ├── SONY ILCE-7RM5__0890.on1
                ├── SONY ILCE-7RM5__0890.xmp
                ├── SONY ILCE-7RM5__0891.arw
                ├── SONY ILCE-7RM5__0891.on1
                ├── SONY ILCE-7RM5__0891.xmp
                ├── SONY ILCE-7RM5__0892.arw
                ├── SONY ILCE-7RM5__0892.on1
                ├── SONY ILCE-7RM5__0892.xmp
            └──  session.json
```
Basis des Ordnernamens ist der Datestamp des ersten Bildes der Session. Session.json enthält alle verarbeiteten Daten.

</details>


### Live-Session-Shaping

Die Sessionbildung ist interaktiv und datengetrieben:
	•	Sessions entstehen initial anhand eines Zeit-Gaps
(Default: neue Session nach 30 Minuten ohne Aufnahme)
	•	Der Gap-Slider passt die Sessiongrenzen in Echtzeit an
→ andere Cluster, andere Bildanzahlen – sofort sichtbar
	•	Vorab-Auswahl problematischer oder irrelevanter Bilder direkt im Scan
- Sessions können am Stück gelöscht, benannt, beschrieben und verschlagwortet werden
	•	Jede Session erhält eine session.json mit allen Metadaten
	•	Gelöschte Bilder werden quellseitig in einen Papierkorb verschoben
(vollständig geloggt, kein Datenverlust)



## Changelog fotostudio-helper [2.0.0] - (not yet released)

### ADDED.
- Folder selection modal for instant source scan ("looking for photosessions")
- complete sessions can be deleted (Super hilfreich, wenn man mit dem Slider eine Reihe "kaputter" Bilder gefunden hat)

### FIXED.
- Session Gap Calculation

### CHANGED.


### REMOVED.
- Camera constraints, Camera polling




## Implementierung

<details>

- Node.js >= 18
- current exiftool
- Works well on MacOs (Standard user folder recognition), clean port to Linux is easy - maybe-Plan. Test it as it is.


```bash
git clone https://github.com/codegarden13/fotostudio-helper
cd studio-helper
npm install
```

</details>



Sende mir *gerne* einen Serviceauftrag zur Implementierung in Deinem Studio mit Deinen Kameras 😊 - oder bring eine Tasse Kaffee mit und wir besprechen das.