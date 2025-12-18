#  fotostudio-helper

<p align="center"><em>Storage workflow app (MacOS, Linux, Windows)</em></p>
<p align="center">
  <img src="./assets/logo.png" alt="Illustration des Projekts" width="100%">

</p>

<p align="center">no matter how you change photo devices: Your sessions are captured.</p>

Kennst Du das: *Kameras und Handys in der Familie, Geräte, die bei verschiedenen Cloudanbietern speichern.* **Alles irgendwie da, aber zerissen** - alles ist irgendwo.

- **Alle Bilder aller Kameras / Handys** landen in einer einheitlichen Ordnerstruktur unter logischen Sessionnamen".
- Software-Agnostic: Statt Struktur-Import in Bildverarbeitungsprogramme nutzen Apps die so entstandene Struktur.
- Fotosessions werden beim Import interaktiv definiert, (optional) speziell benannt und sind im Session-Export namentlich sichtbar.

## Features 
![alt text](assets/screen02.png)
![alt text](assets/screen01.png)

- Interaktives "Sessionshaping" in Echtzeit (Data-Driven Zeit-Gap-Slider). Die Abstände zwischen den Aufnahmen clustern den Slider. 
- Naming der Fotosession für angepassten Import - wirkt sich auch die Session-Ordnernamen am Ziel aus.
- Import in frei definierbare Zielordner

## Next Steps / Future

- 😎 **'Importieren' - Button** anschliessen 
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