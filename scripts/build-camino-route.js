// One-off build script: turns the public "Central Route on the Camino Portugués:
// Porto to Santiago" Google My Maps (by Kayla & Bert-Jan, Walk The Camino Portugués)
// into a small cached GeoJSON file, re-split to match the site's own 13 stages
// (the source map uses its own 10-day split) and simplified for the web.
//
// Source map: https://www.google.com/maps/d/viewer?mid=1XH7KMGMs53i8ABvBa3Eb74Hq3wvYw4M
// KML export: https://www.google.com/maps/d/kml?mid=1XH7KMGMs53i8ABvBa3Eb74Hq3wvYw4M&forcekml=1
//
// Usage: node scripts/build-camino-route.js <path-to-downloaded-kml>
// Not loaded by the live site — output goes to data/camino-central-route.geojson.

const fs = require("fs");
const path = require("path");

const kmlPath = process.argv[2];
if (!kmlPath) {
    console.error("Usage: node scripts/build-camino-route.js <path-to-kml>");
    process.exit(1);
}
const kml = fs.readFileSync(kmlPath, "utf8");

function extractLineStringPlacemarks(xml) {
    const placemarks = [];
    const re = /<Placemark>([\s\S]*?)<\/Placemark>/g;
    let m;
    while ((m = re.exec(xml))) {
        const block = m[1];
        const lsMatch = block.match(/<LineString>([\s\S]*?)<\/LineString>/);
        if (!lsMatch) continue;
        const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/);
        const coordMatch = lsMatch[1].match(/<coordinates>([\s\S]*?)<\/coordinates>/);
        if (!coordMatch) continue;
        const coords = coordMatch[1]
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((triple) => {
                const [lon, lat] = triple.split(",").map(Number);
                return [lon, lat];
            });
        placemarks.push({ name: nameMatch ? nameMatch[1] : "", coords });
    }
    return placemarks;
}

// Ramer-Douglas-Peucker simplification (tolerance in degrees, ~ meters at this latitude / 111000)
function simplify(points, toleranceDeg) {
    if (points.length <= 2) return points;
    function perpDist(p, a, b) {
        const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
        const dx = x2 - x1, dy = y2 - y1;
        if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
        const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
        const px = x1 + t * dx, py = y1 + t * dy;
        return Math.hypot(x - px, y - py);
    }
    function rdp(pts) {
        if (pts.length <= 2) return pts;
        let maxDist = 0, idx = 0;
        for (let i = 1; i < pts.length - 1; i++) {
            const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
            if (d > maxDist) { maxDist = d; idx = i; }
        }
        if (maxDist > toleranceDeg) {
            const left = rdp(pts.slice(0, idx + 1));
            const right = rdp(pts.slice(idx));
            return left.slice(0, -1).concat(right);
        }
        return [pts[0], pts[pts.length - 1]];
    }
    return rdp(points);
}

function nearestIndex(track, target) {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < track.length; i++) {
        const d = Math.hypot(track[i][0] - target[0], track[i][1] - target[1]);
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return { index: best, distDeg: bestDist };
}

// Index where cumulative real-world distance along the track first reaches targetKm.
function indexAtDistanceKm(track, targetKm) {
    let d = 0;
    for (let i = 1; i < track.length; i++) {
        d += haversine(track[i - 1], track[i]) / 1000;
        if (d >= targetKm) return i;
    }
    return track.length - 1;
}

// Real-world distance (meters) between two [lon, lat] points.
function haversine(a, b) {
    const R = 6371000;
    const [lon1, lat1] = a, [lon2, lat2] = b;
    const dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const la1 = lat1 * Math.PI / 180, la2 = lat2 * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// Measured from the SIMPLIFIED coordinates, not the raw GPS log. Summing every
// raw point-to-point hop hugely overstates distance because consumer GPS noise
// (each fix wobbles a few meters off the real path) accumulates over tens of
// thousands of points — the same reason Strava/Garmin/Komoot smooth a track
// before reporting its length instead of summing raw points. The ~6-7 m RDP
// tolerance below is exactly in that standard noise-filtering range, so it's
// used for both the rendered line and the reported distance.
function trackLengthKm(coords) {
    let d = 0;
    for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
    return d / 1000;
}

function formatKm(km) {
    return km.toFixed(1).replace(".", ",") + " km";
}

const raw = extractLineStringPlacemarks(kml);
console.log(`Found ${raw.length} LineString placemarks:`);
raw.forEach((p, i) => console.log(`  [${i}] ${p.name} (${p.coords.length} points)`));
if (raw.length !== 10) {
    console.error("Expected exactly 10 day-tracks from the source KML — got " + raw.length + ". Aborting.");
    process.exit(1);
}

// [lon, lat] split targets, geocoded via Nominatim (OSM)
const SPLITS = {
    balugaes: [-8.6355897, 41.6432080],
    oPorrino: [-8.6255949, 42.1364387],
    oMilladoiro: [-8.5782157, 42.8449509],
};

function splitTrack(track, target, label) {
    const { index, distDeg } = nearestIndex(track, target);
    console.log(`  split at ${label}: vertex ${index}/${track.length - 1}, ~${Math.round(distDeg * 111000)} m from geocoded point`);
    return [track.slice(0, index + 1), track.slice(index)];
}

const [barcelosBalugaes, balugaesPonteDeLima] = splitTrack(raw[2].coords, SPLITS.balugaes, "Balugães");
const [tuiOPorrino, oPorrinoRedondela] = splitTrack(raw[5].coords, SPLITS.oPorrino, "O Porriño");
const [padronOMilladoiro, oMilladoiroSantiago] = splitTrack(raw[9].coords, SPLITS.oMilladoiro, "O Milladoiro");

// Overnight changed from Barcelinhos to Pedra Furada (Albergue O Palhuço), which
// lies BEFORE Barcelos on the Vairão→Barcelos track (confirmed: only ~11 m from
// the real albergue location per Google Maps). So stage 2 now ends there, and
// stage 3 continues from there, straight through Barcelos (no longer an
// overnight stop, just passed through), to the existing Balugães split point.
const PEDRA_FURADA = [-8.6364478, 41.4678268]; // Google Maps place "Albergue Palhuço"
const [vairaoPedraFurada, pedraFuradaBarcelos] = splitTrack(raw[1].coords, PEDRA_FURADA, "Pedra Furada");
const pedraFuradaBalugaes = pedraFuradaBarcelos.concat(barcelosBalugaes);

// Overnight for 04.09. changed again, from Balugães (Casa Altamira) to Aborim
// (Albergue de Peregrinos Casa de Santiago), which sits directly on this same
// track ~4 km before Balugães (confirmed: only ~42 m from the geocoded place on
// the Pedra Furada→Balugães track — right at the trail, as Gronze describes it).
// So stage 3 now ends there, and stage 4 starts there, straight through Balugães
// (no longer an overnight stop, just passed through) to Ponte de Lima.
const ABORIM = [-8.6359091, 41.6113718]; // Google Maps place "Albergue de Peregrinos Casa de Santiago"
const [pedraFuradaAborim, aborimBalugaes] = splitTrack(pedraFuradaBalugaes, ABORIM, "Aborim");
const aborimPonteDeLima = aborimBalugaes.concat(balugaesPonteDeLima.slice(1));

// Day 1 in real life isn't one continuous walk: ~3 km through Porto on foot,
// then public transport (bus/metro) to the Padrão Moreira stop, then walking
// again to Vairão. Split the source track the same way so the map shows it.
const PADRAO_MOREIRA = [-8.6489722, 41.2471389]; // OSM bus_stop node 6959350625
const CITY_WALK_KM = 3;
const cityWalkEndIdx = indexAtDistanceKm(raw[0].coords, CITY_WALK_KM);
const { index: busStopIdx, distDeg: busStopDistDeg } = nearestIndex(raw[0].coords, PADRAO_MOREIRA);
console.log(`  Tag 1: Fußweg endet bei Index ${cityWalkEndIdx} (${CITY_WALK_KM} km), Bus endet bei Index ${busStopIdx} (~${Math.round(busStopDistDeg * 111000)} m von Padrão Moreira)`);
if (busStopIdx <= cityWalkEndIdx) {
    console.error("Padrão Moreira liegt nicht hinter dem 3-km-Fußweg-Punkt auf Tag 1 — Split-Reihenfolge prüfen.");
    process.exit(1);
}
const portoWalk1 = raw[0].coords.slice(0, cityWalkEndIdx + 1);
const portoBus = raw[0].coords.slice(cityWalkEndIdx, busStopIdx + 1);
const portoWalk2 = raw[0].coords.slice(busStopIdx);

// Overnight for 02.09. changed from the monastery albergue in Vairão to Casa da
// Laura, which is ~1.9 km away in Vilarinho and NOT on the source hiker's
// recorded track (they stayed in Vairão). This one connector segment IS
// hand-typed, unlike everything else here — it's an OSRM foot-routing result
// (router.project-osrm.org) between the track's old Vairão endpoint and Casa da
// Laura's geocoded address, not a recorded GPS track. Distance: 1906.7 m.
const VAIRAO_VILARINHO_CONNECTOR = [
    [-8.670266, 41.331899], [-8.670211, 41.331923], [-8.669987, 41.332045],
    [-8.669634, 41.332277], [-8.669187, 41.332653], [-8.669383, 41.332577],
    [-8.669662, 41.332495], [-8.669997, 41.332434], [-8.670533, 41.332417],
    [-8.670609, 41.332448], [-8.670729, 41.332515], [-8.670813, 41.33255],
    [-8.670896, 41.332577], [-8.671285, 41.332539], [-8.671402, 41.332524],
    [-8.671509, 41.332542], [-8.671594, 41.332595], [-8.671931, 41.332973],
    [-8.672076, 41.333179], [-8.672274, 41.333509], [-8.672331, 41.333636],
    [-8.672402, 41.333922], [-8.672494, 41.334206], [-8.672485, 41.334341],
    [-8.672442, 41.33446], [-8.672062, 41.334973], [-8.672075, 41.334977],
    [-8.673443, 41.335335], [-8.675521, 41.33588], [-8.677206, 41.336317],
    [-8.677706, 41.336432], [-8.678175, 41.336556], [-8.678348, 41.336602],
    [-8.678852, 41.336732], [-8.679305, 41.336886], [-8.679612, 41.337057],
    [-8.680173, 41.337463], [-8.681258, 41.338195], [-8.681427, 41.338298],
    [-8.6819, 41.338195], [-8.682317, 41.338106], [-8.682033, 41.338824],
    [-8.681745, 41.339605], [-8.68143, 41.340431], [-8.680989, 41.340362],
    [-8.680889, 41.340332], [-8.680828, 41.340303],
];
const VILARINHO = VAIRAO_VILARINHO_CONNECTOR[VAIRAO_VILARINHO_CONNECTOR.length - 1];
// portoWalk2's last point ~= the connector's first point (same real-world spot); drop the duplicate.
const portoWalk2ToVilarinho = portoWalk2.concat(VAIRAO_VILARINHO_CONNECTOR.slice(1));

// The site's own 13 stages (day2..day14 in jakobsweg.html), in order.
// km is left empty here on purpose — it is measured from the real GPS coordinates
// below (trackLengthKm), never hand-typed, so it can't drift from the actual route.
// Most stages are a single walked leg; stage 1 has three legs (walk/bus/walk).
const STAGES = [
    { stage: 1, label: "Porto → Vilarinho", date: "02.09.2026", note: "", legs: [
        { mode: "walk", coords: portoWalk1 },
        { mode: "bus", coords: portoBus },
        { mode: "walk", coords: portoWalk2ToVilarinho },
    ] },
    // Vilarinho is a ~1.9 km detour off the recorded route (see connector above), so
    // stage 2 starts by walking back to the old Vairão point before it rejoins the track.
    { stage: 2, label: "Vilarinho → Pedra Furada", date: "03.09.2026", note: "", legs: [{ mode: "walk", coords: [...VAIRAO_VILARINHO_CONNECTOR].reverse().slice(0, -1).concat(vairaoPedraFurada) }] },
    { stage: 3, label: "Pedra Furada → Aborim", date: "04.09.2026", note: "", legs: [{ mode: "walk", coords: pedraFuradaAborim }] },
    { stage: 4, label: "Aborim → Ponte de Lima", date: "05.09.2026", note: "", legs: [{ mode: "walk", coords: aborimPonteDeLima }] },
    { stage: 5, label: "Ponte de Lima → Rubiães", date: "06.09.2026", note: "Königsetappe", legs: [{ mode: "walk", coords: raw[3].coords }] },
    { stage: 6, label: "Rubiães → Tui", date: "07.09.2026", note: "Grenzübertritt", legs: [{ mode: "walk", coords: raw[4].coords }] },
    { stage: 7, label: "Tui → O Porriño", date: "08.09.2026", note: "", legs: [{ mode: "walk", coords: tuiOPorrino }] },
    { stage: 8, label: "O Porriño → Redondela", date: "09.09.2026", note: "", legs: [{ mode: "walk", coords: oPorrinoRedondela }] },
    { stage: 9, label: "Redondela → Pontevedra", date: "10.09.2026", note: "", legs: [{ mode: "walk", coords: raw[6].coords }] },
    { stage: 10, label: "Pontevedra → Caldas de Reis", date: "11.09.2026", note: "", legs: [{ mode: "walk", coords: raw[7].coords }] },
    { stage: 11, label: "Caldas de Reis → Padrón", date: "12.09.2026", note: "", legs: [{ mode: "walk", coords: raw[8].coords }] },
    { stage: 12, label: "Padrón → O Milladoiro", date: "13.09.2026", note: "", legs: [{ mode: "walk", coords: padronOMilladoiro }] },
    { stage: 13, label: "O Milladoiro → Santiago de Compostela", date: "14.09.2026", note: "Ziel", legs: [{ mode: "walk", coords: oMilladoiroSantiago }] },
];

const WAYPOINTS = [
    { name: "Porto", type: "town", coord: raw[0].coords[0] },
    { name: "Padrão Moreira", type: "transit", coord: raw[0].coords[busStopIdx] },
    { name: "Vilarinho", type: "town", coord: VILARINHO },
    { name: "Pedra Furada", type: "town", coord: vairaoPedraFurada[vairaoPedraFurada.length - 1] },
    { name: "Aborim", type: "town", coord: pedraFuradaAborim[pedraFuradaAborim.length - 1] },
    { name: "Ponte de Lima", type: "town", coord: balugaesPonteDeLima[balugaesPonteDeLima.length - 1] },
    { name: "Rubiães", type: "town", coord: raw[3].coords[raw[3].coords.length - 1] },
    { name: "Tui", type: "town", coord: raw[4].coords[raw[4].coords.length - 1] },
    { name: "O Porriño", type: "town", coord: tuiOPorrino[tuiOPorrino.length - 1] },
    { name: "Redondela", type: "town", coord: oPorrinoRedondela[oPorrinoRedondela.length - 1] },
    { name: "Pontevedra", type: "town", coord: raw[6].coords[raw[6].coords.length - 1] },
    { name: "Caldas de Reis", type: "town", coord: raw[7].coords[raw[7].coords.length - 1] },
    { name: "Padrón", type: "town", coord: raw[8].coords[raw[8].coords.length - 1] },
    { name: "O Milladoiro", type: "town", coord: padronOMilladoiro[padronOMilladoiro.length - 1] },
    { name: "Santiago de Compostela", type: "town", coord: oMilladoiroSantiago[oMilladoiroSantiago.length - 1] },
];

const TOLERANCE_DEG = 0.00006; // ~6-7 m at this latitude

const features = [];
let totalBefore = 0, totalAfter = 0, totalKm = 0;

STAGES.forEach((s) => {
    s.legs.forEach((leg) => {
        const simplified = simplify(leg.coords, TOLERANCE_DEG);
        totalBefore += leg.coords.length;
        totalAfter += simplified.length;
        const kmValue = trackLengthKm(simplified);
        totalKm += kmValue;
        console.log(`  Stage ${s.stage} ${s.label} [${leg.mode}]: ${formatKm(kmValue)} (aus ${leg.coords.length} -> ${simplified.length} geglätteten GPS-Punkten)`);
        features.push({
            type: "Feature",
            properties: { stage: s.stage, label: s.label, date: s.date, km: formatKm(kmValue), note: s.note, mode: leg.mode },
            geometry: { type: "LineString", coordinates: simplified },
        });
    });
});

WAYPOINTS.forEach((w, i) => {
    features.push({
        type: "Feature",
        properties: { name: w.name, stage: i, type: w.type },
        geometry: { type: "Point", coordinates: w.coord },
    });
});

const geojson = { type: "FeatureCollection", features };
const outDir = path.join(__dirname, "..", "data");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "camino-central-route.geojson");
fs.writeFileSync(outPath, JSON.stringify(geojson));

console.log(`\nGemessene Gesamtlänge: ${formatKm(totalKm)} (Ø ${formatKm(totalKm / STAGES.length)}/Etappe)`);
console.log(`Points before simplification: ${totalBefore}`);
console.log(`Points after simplification:  ${totalAfter}`);
console.log(`Waypoints: ${WAYPOINTS.length}`);
console.log(`Wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
