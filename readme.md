#  fotostudio-helper

Kennst Du das: *Kameras und Handys in der Familie, Geräte, die bei verschiedenen Cloudanbietern speichern.* **Alles irgendwie da, aber zerissen** - alles ist irgendwo.

<p align="center"><em>Storage workflow app (MacOS, Linux, Windows)</em></p>
<p align="center">
  <img src="./assets/logo.png" alt="Illustration des Projekts" width="100%">

</p>

<p align="center">no matter how you change photo devices: Your sessions are captured.</p>

## Features
- Software-Agnostic: keine Abhängigkeit durch Struktur-Import Bildverarbeitungsprogramme
- Nachbereitung von Fotosessions direkt beim Kunden
  - Interaktives "Sessionshaping" in Echtzeit (Data-Driven Zeit-Gap-Slider). Die Abstände zwischen den Aufnahmen clustern den Slider. 
- Studio: Bilder **aller Kameras / Handys** landen in einer einheitlichen Ordnerstruktur mit logischen Sessionnamen (Default: NAS-Speicherort/Volume/Something/YYYY). Der Zielort ist änderbar.
  - Fotosessions werden für den Import interaktiv definiert, (optional) speziell benannt und sind im Session-Export namentlich sichtbar.

## Usage

### Warten auf Kamera
![alt text](assets/screen01.png)
### Verbundene Kamera, nach Scan
![alt text](assets/screen02.png)


## Next Steps / Future

- 😎 **'Importieren' - Button** anschliessen 
- Import in frei definierbare Zielordner
- Interaktiver Metrik - Graph per Session
- ... Update von Sony Custom Settings
  
## Voraussetzungen
- Node.js >= 18

Installation
```bash
git clone https://github.com/codegarden13/fotostudio-helper
cd studio-helper
npm install
```