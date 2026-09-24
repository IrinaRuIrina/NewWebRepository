// Reiseführer Jakobsweg: Foto-Lightbox der Etappen und interaktive Routenkarte (Leaflet).

// ---- Lightbox: Klick auf ein Etappenfoto zeigt es groß an ----
(function () {
    const lightbox = document.getElementById('stage-lightbox');
    const lightboxImg = document.getElementById('stage-lightbox-img');

    document.querySelectorAll('.stage-img').forEach((img) => {
        img.addEventListener('click', () => {
            lightboxImg.src = img.src;
            lightboxImg.alt = img.alt;
            lightbox.classList.add('show');
        });
    });
    lightbox.addEventListener('click', () => lightbox.classList.remove('show'));
})();

// ---- Routenkarte: zeichnet Etappen und Orte aus data/camino-central-route.geojson ----
(function () {
    const mapEl = document.getElementById('camino-map');
    if (!mapEl || !window.L) return;

    // Eine Farbe pro Etappe (wiederholt sich, falls es mehr Etappen als Farben gibt)
    const STAGE_COLORS = [
        '#8a5a38', '#b5651d', '#6b8e23', '#2f6f6f', '#a4243b',
        '#5c6b73', '#c08a2e', '#3c6e71', '#9a4f3c', '#4a6b3e',
        '#7a5c8e', '#c1666b', '#546e7a',
    ];
    const NOTE_BADGE = { 'Königsetappe': ' 👑', 'Grenzübertritt': ' 🇪🇸', 'Ziel': ' 🏁' };
    const PLAN_CHANGED = 'Plan geändert';

    const map = L.map(mapEl, { scrollWheelZoom: false, attributionControl: false });
    L.control.attribution({ prefix: false }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
    }).addTo(map);

    function drawStage(feature, group) {
        const props = feature.properties;
        const latlngs = feature.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
        const color = STAGE_COLORS[(props.stage - 1) % STAGE_COLORS.length];
        const badge = NOTE_BADGE[props.note] || '';
        const isBus = props.mode === 'bus';
        const isBoat = props.mode === 'boat';
        const isTransport = isBus || isBoat;
        const isPlanChanged = props.note === PLAN_CHANGED;

        const modeLabel = isBus ? ' 🚌' : (isBoat ? ' ⛴️' : '');
        const changeNote = isPlanChanged ? '<br><em>⚠️ Plan geändert — siehe Übernachtungen</em>' : '';

        // Geänderte Etappen gestrichelt, Bus-/Bootsstrecken gepunktet
        let dashArray = null;
        if (isPlanChanged) dashArray = '6, 6';
        else if (isTransport) dashArray = '2, 8';

        L.polyline(latlngs, { color, weight: 4, opacity: isTransport ? 0.7 : 0.85, dashArray })
            .bindPopup(`<strong>${props.label}</strong><br>${props.date} · ${props.km}${modeLabel}${badge}${changeNote}`)
            .addTo(group);
    }

    function drawPlace(feature, group) {
        const props = feature.properties;
        const [lon, lat] = feature.geometry.coordinates;
        const isTransit = props.type === 'transit';
        const isRealChange = props.type === 'real-change';

        let radius = 5;
        let fillColor = '#6b452b';
        if (isRealChange) { radius = 7; fillColor = '#a4243b'; }
        else if (isTransit) { radius = 6; fillColor = '#2f6f6f'; }

        L.circleMarker([lat, lon], { radius, color: '#fff', weight: 2, fillColor, fillOpacity: 1 })
            .bindPopup(`<strong>${props.name}</strong>${isTransit ? ' 🚌' : ''}${isRealChange ? ' — echte Route' : ''}`)
            .addTo(group);
    }

    fetch('data/camino-central-route.geojson')
        .then((response) => response.json())
        .then((geojson) => {
            const group = L.featureGroup().addTo(map);
            geojson.features.filter((f) => f.geometry.type === 'LineString').forEach((f) => drawStage(f, group));
            geojson.features.filter((f) => f.geometry.type === 'Point').forEach((f) => drawPlace(f, group));
            map.fitBounds(group.getBounds(), { padding: [16, 16] });
        })
        .catch((err) => console.error('Camino-Karte konnte nicht geladen werden:', err));
})();
