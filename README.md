# barvenko.de

Persönliche Website (Reisen & Lifestyle) mit Reiseführer und Reisetagebuch zum
Jakobsweg (Camino Portugués). Reines HTML/CSS/JavaScript ohne Build-Schritt,
veröffentlicht über GitHub Pages (Domain siehe `CNAME`).

## Seiten

| Datei                      | Inhalt                                                        |
|----------------------------|---------------------------------------------------------------|
| `index.html`               | Startseite: Über mich, Galerie, Abenteuer, Kontakt            |
| `jakobsweg.html`           | Reiseführer: Etappen, Übernachtungen, Karte, Kosten, Quellen  |
| `packliste-final.html`     | Endgültige Packliste mit Fotogalerie                          |
| `geschichte-legenden.html` | Geschichte & Legenden des Camino Portugués                    |
| `tagebuch.html`            | Reisetagebuch (Firebase, Einträge nur nach Anmeldung)         |
| `notizen.html`             | Private Notizen (Firebase, nicht verlinkt, nur mit Login)     |

Die HTML-Seiten liegen bewusst im Hauptordner, damit die öffentlichen Adressen
(z. B. `barvenko.de/jakobsweg.html`) gleich bleiben.

## Ordnerstruktur

```
css/
  style.css              Gemeinsame Styles (Navigation, Footer, Startseite, Sprachumschalter)
  <seite>.css            Seitenspezifische Styles
js/
  i18n.js                Sprachumschaltung DE/EN/RU für alle Seiten
  navigation.js          Mobiles Menü, Navigationsleiste, „Nach oben/unten“
  jakobsweg.js           Etappen-Lightbox und Routenkarte (Leaflet)
  packliste-final.js     Lightbox der Packlisten-Fotos
  tagebuch.js            Reisetagebuch (ES-Modul)
  notizen.js             Private Notizen (ES-Modul)
  gemeinsam/
    firebase.js          Firebase-Verbindung (Firestore + Anmeldung)
    hilfsfunktionen.js   esc, t, formatDate, resizeImage …
  uebersetzungen/
    <seite>.js           Übersetzungstexte je Seite
images/
  startseite/            Bilder der Startseite
  jakobsweg/             Bilder zum Jakobsweg
data/
  camino-central-route.geojson   Route für die Karte im Reiseführer
```

## Übersetzungen

Texte werden im HTML über Attribute markiert (`data-i18n`, `data-i18n-html`,
`data-i18n-alt`, `data-i18n-placeholder`, `data-i18n-aria-label`). Die passenden
Texte stehen in `js/uebersetzungen/<seite>.js`. Neue Texte immer in allen drei
Sprachen (`de`, `en`, `ru`) ergänzen.

## Routenkarte

`data/camino-central-route.geojson` wurde ursprünglich aus der öffentlichen Google-My-Maps-Karte
„Central Route on the Camino Portugués“ erzeugt und danach von Hand an die tatsächlich
gelaufene Route angepasst (Ruhetag Islas Cíes, Spiritueller Weg, Pilgerboot).
Änderungen daher direkt in dieser Datei vornehmen.

## Lokal ansehen

Wegen der ES-Module und des Ladens der GeoJSON-Datei über einen lokalen Webserver öffnen:

```bash
python -m http.server 8000
```

Danach `http://localhost:8000` im Browser aufrufen.
