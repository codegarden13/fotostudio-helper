#  fotostudio-helper
*Solid Photo Storage workflow app (MacOS, Linux)*

Kennst Du das: *Kameras und Handys in der Familie, Geräte, die bei verschiedenen Cloudanbietern speichern.* **Alles irgendwie da, aber verteilt** - alles ist irgendwo. Das kann man ändern ... 

<p align="center">
  <img src="./assets/logo.png" alt="Illustration fotostudio-helper" width="100%">

</p>

<p align="center">No matter how often you switch photo devices: Your sessions are captured.</p>

## Features
- Skalierbare Langzeitarchivierung - **"Software-Agnostic": keine Abhängigkeit** durch Struktur-Importe in irgendeines Deiner Bildverarbeitungsprogramme.
- Präsentation von Fotosessions direkt beim Kunden
  - Interaktives "Sessionshaping" in Echtzeit (Data-Driven Zeit-Gap-Slider). Die Abstände zwischen den Aufnahmen clustern den Slider. 
- Studio: Bilder **aller Kameras / Handys** landen in einer einheitlichen Ordnerstruktur mit logischen Sessionnamen (Default: NAS-Speicherort/Volume/Something/YYYY). Der Zielort ist änderbar.
  - Fotosessions werden für den Import interaktiv definiert, (optional) speziell benannt und sind im Session-Export namentlich sichtbar.
  - Prinzipell kann **jeder** gemountete Datenträger eingelesen werden, auch ein USB-Stick. Fotostudio-helper muss auf DEINE Devices konfiguriert werden. Einbinden weiterer spezielle Profile kannst Du selbst - daneben biete ich es als Dienstleistung an. Aktueller Default und Schwerpunkt: Sony Kameras.

## Usage

### Kamera verbinden
Warten auf Kamera
![alt text](assets/screen01.png)

### Scannen
### Fotosessions justieren und wählen 
![alt text](assets/screen02.png)
### Fotosession optional umbenennen 

### sichern / exportieren 


## Upcoming Features

- 😎 **'Importieren' - Button** anschliessen plus Import in frei definierbare Zielordner
- Farbpalette aus Bildserien/Sessions ableiten (HEX / RGB / HSL)
- Import aus *Iphone* und *Canon-Kameras* (, was gemounted ist - USB-Sticks, Iphones, Kameras.
- Interaktiver Metrik - Graph per Session
- Update von Sony Custom Settings 
  
## Installation


- Node.js >= 18

Installation
```bash
git clone https://github.com/codegarden13/fotostudio-helper
cd studio-helper
npm install
```
Bei Bedarf: 

Sende mir *gerne* einen Serviceauftrag zur Implementierung in Deinem Studio mit Deinen Kameras 😊 - oder eine Tasse Kaffee !