#  fotostudio-helper - a storage workflow app

<p align="center"><em>(MacOS, Linux, Windows)</em></p>
<p align="center">
  <img src="./assets/logo.png" alt="Illustration des Projekts" width="100%">

</p>



Kennst Du das: *Kameras und Handys in der Familie, Geräte, die bei verschiedenen Cloudanbietern speichern.* **Alles irgendwie da, aber zerissen** - alles ist irgendwo.

Ziele: 
- **Alle Bilder aller Kameras / Handys** sollen in einer einheitlichen Ordnerstruktur unter logischen Sessionnamen" abgelegt werden.
- Kein Struktur-Import in Bildverarbeitungsprogramme, stattdessen sollen Programme die existierende Struktur nutzen.
- Fotosessions werden beim Import definiert und sind in den Exporten namentlich sichtbar.

## Features 

![alt text](assets/screen01.png)

- Interaktives "Sessionshaping" in Echtzeit (Data-Driven Zeit-Gap-Slider). Die Abstände zwischen den Aufnahmen clustern den Slider. 
- Naming der Fotosession für angepassten Import - wirkt sich auch die Session-Ordnernamen am Ziel aus.
- Import in frei definierbare Zielordner

## Next Steps / Future

-  Interaktiver Metrik - Graph per Session
-  ... Update von Sony Custom Settings
  
## Voraussetzungen
- Node.js >= 18

Installation
```bash
git clone https://github.com/codegarden13/fotostudio-helper
cd studio-helper
npm install
```