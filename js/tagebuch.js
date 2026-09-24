// Reisetagebuch: Einträge aus Firestore laden, anzeigen, übersetzen und
// (nach Anmeldung) anlegen, bearbeiten und löschen.
import {
    collection, addDoc, updateDoc, deleteDoc, doc,
    onSnapshot, query, orderBy, limit, serverTimestamp, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
    signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { db, auth } from "./gemeinsam/firebase.js";
import { currentLang, t, esc, formatDate, resizeImage } from "./gemeinsam/hilfsfunktionen.js";

let isLoggedIn = false;
let entries = [];
let draftPhotos = [];

// Die Fotos stecken als Base64 direkt in den Einträgen (siehe resizeImage() und
// payload.photos). Alle Einträge auf einmal zu laden hieße, bei jedem Seitenaufruf
// sämtliche Fotos herunterzuladen. Deshalb wird seitenweise geladen; die genaue
// Gesamtzahl kommt aus einer separaten, schlanken Zählabfrage ohne Eintragsinhalte.
let entriesLoaded = false;
let totalCount = null;
let hasMore = false;
let loadingMore = false;
let pageSize = 15;
const PAGE_STEP = 15;
let unsubscribeEntries = null;

// ---- Übersetzung (MyMemory: kostenlos, ohne API-Schlüssel, läuft auf jedem Gerät) ----
// Wird nur für die DE/EN/RU-Schaltflächen genutzt, die ein Leser sieht, wenn ein
// Eintrag noch keine vorbereitete Übersetzung hat. Im Eintragsformular wird nicht
// mehr automatisch übersetzt – jede Sprache wird dort selbst geschrieben (siehe
// openEntrySheet), da maschinelle Übersetzungen (v. a. das grammatische Geschlecht
// im Russischen) nicht zuverlässig genug sind, um sie ungeprüft zu speichern.
const ALL_LANGS = ["de", "en", "ru"];

async function translateChunk(text, source, target) {
    if (!text.trim()) return "";
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data.responseStatus != 200 || !data.responseData) throw new Error(data.responseDetails || "Übersetzung fehlgeschlagen");
    return data.responseData.translatedText;
}

// MyMemory erlaubt höchstens 500 Zeichen pro Anfrage. Lange Einträge werden daher
// absatzweise in satzgroße Stücke geteilt, einzeln übersetzt und wieder zusammengefügt.
function chunkParagraph(para, maxLen) {
    const chunks = [];
    let rest = para;
    while (rest.length > maxLen) {
        let cut = rest.lastIndexOf(". ", maxLen);
        if (cut < maxLen * 0.3) cut = rest.lastIndexOf(" ", maxLen);
        if (cut <= 0) cut = maxLen;
        chunks.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1);
    }
    if (rest.trim()) chunks.push(rest.trim());
    return chunks;
}

// Fasst aufeinanderfolgende Wörter derselben Schrift zusammen. Nötig, weil ein Satz
// mittendrin die Sprache wechseln kann (z. B. Russisch mit eingestreutem Deutsch).
// Würde die Sprache pro Absatz bestimmt, bliebe der nicht passende Teil unübersetzt;
// so bekommt jeder Abschnitt seine eigene, richtige Ausgangssprache.
function splitByScript(text) {
    const words = text.split(/\s+/).filter(Boolean);
    const runs = [];
    for (const w of words) {
        const script = detectLang(w);
        if (runs.length && runs[runs.length - 1].script === script) {
            runs[runs.length - 1].words.push(w);
        } else {
            runs.push({ script, words: [w] });
        }
    }
    return runs.map((r) => ({ script: r.script, text: r.words.join(" ") }));
}

// Übersetzt einen langen Text in die Zielsprache. Die Ausgangssprache wird pro
// Wortgruppe erkannt statt für den ganzen Eintrag – ein Text kann Sprachen mischen.
// Abschnitte, die schon in der Zielsprache sind, bleiben unverändert.
async function translateLongText(text, target) {
    if (!text || !text.trim()) return "";
    const paragraphs = text.split(/\n+/);
    const out = [];
    for (const para of paragraphs) {
        if (!para.trim()) { out.push(""); continue; }
        const runs = splitByScript(para.trim());
        const translatedRuns = [];
        for (const run of runs) {
            if (run.script === target) { translatedRuns.push(run.text); continue; }
            const chunks = chunkParagraph(run.text, 450);
            const translatedChunks = [];
            for (const c of chunks) translatedChunks.push(await translateChunk(c, run.script, target));
            translatedRuns.push(translatedChunks.join(" "));
        }
        out.push(translatedRuns.join(" "));
    }
    return out.join("\n");
}

// ---- Sprache erkennen und passende Übersetzung wählen ----

// Richtige Pluralform von „Eintrag“ je Sprache (Russisch hat drei Formen).
function pluralEntries(n) {
    const lang = currentLang();
    if (lang === "en") return n === 1 ? "entry" : "entries";
    if (lang === "ru") {
        const mod10 = n % 10, mod100 = n % 100;
        if (mod10 === 1 && mod100 !== 11) return "запись";
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "записи";
        return "записей";
    }
    return n === 1 ? "Eintrag" : "Einträge";
}

// Die Sprache wird allein aus dem Text bestimmt, nie aus gespeicherten Metadaten –
// eine manuell gewählte Sprache wird zu leicht vergessen und hat früher Übersetzungen
// unbemerkt kaputt gemacht. Kyrillisch ist eindeutig; alles andere gilt als Deutsch
// (die Grundsprache der Seite).
function detectLang(text) {
    return /[Ѐ-ӿ]/.test(text || "") ? "ru" : "de";
}

// Ein gespeichertes Sprachfeld (z. B. text_ru) wird nur verwendet, wenn seine Schrift
// auch zur Sprache passt. So korrigiert sich die Anzeige selbst, falls ältere Daten
// falsch gespeichert wurden.
function fieldMatchesLang(value, lang) {
    if (!value) return false;
    const looksRu = /[Ѐ-ӿ]/.test(value);
    return lang === "ru" ? looksRu : !looksRu;
}
function hasTrustedField(entry, field, lang) {
    const v = entry[field + "_" + lang];
    return v != null && v !== "" && fieldMatchesLang(v, lang);
}

// Liefert das Feld in der gewünschten Sprache, sonst den Originaltext.
function localizedField(entry, field, lang) {
    if (hasTrustedField(entry, field, lang)) return entry[field + "_" + lang];
    return entry[field] || "";
}

// Immer dieselben drei Schaltflächen (DE/EN/RU), unabhängig von der Seitensprache –
// ein Klick zeigt genau DIESEN Eintrag in der gewählten Sprache.
function langButtonsHtml(entryId) {
    return `<div class="diary-translate-row">${ALL_LANGS.map((l) =>
        `<button type="button" class="diary-translate-inline" data-entry-id="${esc(entryId)}" data-target-lang="${l}">${l.toUpperCase()}</button>`
    ).join("")}</div>`;
}

// Zwischenspeicher für Übersetzungen: "<entryId>_<lang>_<field>" -> übersetzter Text
const onDemandTranslateCache = {};

// Titel und Text werden unabhängig voneinander aufgelöst – ein Eintrag kann für das
// eine eine manuelle Übersetzung haben und für das andere nicht (z. B. text_ru
// ausgefüllt, title_ru leer). Früher ging dadurch eine gute Übersetzung verloren.
async function resolveTranslatedField(entry, field, targetLang) {
    if (hasTrustedField(entry, field, targetLang)) return entry[field + "_" + targetLang];
    const orig = entry[field] || "";
    if (!orig) return "";
    const cacheKey = entry.id + "_" + targetLang + "_" + field;
    if (onDemandTranslateCache[cacheKey] != null) return onDemandTranslateCache[cacheKey];
    const translated = await translateLongText(orig, targetLang);
    onDemandTranslateCache[cacheKey] = translated;
    return translated;
}

async function switchEntryLang(entry, targetLang, titleEl, textEl, btn) {
    const origLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";
    try {
        const title = await resolveTranslatedField(entry, "title", targetLang);
        const text = await resolveTranslatedField(entry, "text", targetLang);
        if (titleEl) titleEl.textContent = title;
        if (textEl) textEl.textContent = text;
    } catch (err) {
        alert(t('entry.translateFailedAlert', 'Übersetzung fehlgeschlagen.'));
    } finally {
        btn.disabled = false;
        btn.textContent = origLabel;
    }
}

// ---- Anzeige der Einträge ----
function renderEntry(entry) {
    const lang = currentLang();
    const title = localizedField(entry, "title", lang);
    const text = localizedField(entry, "text", lang);
    const photos = (entry.photos || []).map(p =>
        `<img src="${p}" alt="${esc(t('photo.alt', 'Foto zum Tagebucheintrag'))}" loading="lazy">`).join("");
    return `
        <article class="diary-entry" data-open="${esc(entry.id)}">
            <div class="diary-entry-head">
                <div>
                    <div class="diary-entry-title" data-title-el="${esc(entry.id)}">${esc(title)}</div>
                    <div class="diary-entry-date">${esc(formatDate(entry.createdAt))}</div>
                </div>
                ${isLoggedIn ? `<div class="diary-entry-actions">
                    <button class="diary-entry-edit" aria-label="${esc(t('entry.edit', 'Bearbeiten'))}" data-edit="${esc(entry.id)}">✏️</button>
                    <button class="diary-entry-del" aria-label="${esc(t('entry.delete', 'Löschen'))}" data-del="${esc(entry.id)}">✕</button>
                </div>` : ""}
            </div>
            ${text ? `<p class="diary-entry-text-preview" data-text-el="${esc(entry.id)}">${esc(text)}</p><p class="diary-entry-more">${esc(t('entry.readMore', 'Weiterlesen →'))}</p>` : ""}
            ${langButtonsHtml(entry.id)}
            ${photos ? `<div class="diary-entry-photos">${photos}</div>` : ""}
        </article>`;
}

async function deleteEntry(id, triggerBtn) {
    if (!confirm(t('entry.delete.confirm', 'Diesen Eintrag wirklich löschen?'))) return;
    if (triggerBtn) triggerBtn.disabled = true;
    try {
        await deleteDoc(doc(db, "entries", id));
        closeBackdrop();
    } catch (e) {
        alert(t('entry.delete.failed', 'Löschen fehlgeschlagen: ') + e.message);
        if (triggerBtn) triggerBtn.disabled = false;
    }
}

function openDetailView(entry) {
    const lang = currentLang();
    const title = localizedField(entry, "title", lang);
    const text = localizedField(entry, "text", lang);
    const photos = (entry.photos || []).map(p =>
        `<img src="${p}" alt="${esc(t('photo.alt', 'Foto zum Tagebucheintrag'))}">`).join("");
    const div = openBackdrop(`
        <h2 id="detail-title">${esc(title)}</h2>
        <div class="diary-detail-date">${esc(formatDate(entry.createdAt))}</div>
        ${langButtonsHtml(entry.id)}
        ${text ? `<p class="diary-detail-text" id="detail-text">${esc(text)}</p>` : ""}
        ${photos ? `<div class="diary-entry-photos" style="margin-top:1rem">${photos}</div>` : ""}
        ${isLoggedIn ? `<div class="diary-sheet-actions">
            <button type="button" class="diary-btn diary-btn-secondary" id="detail-edit">${esc(t('entry.edit', 'Bearbeiten'))}</button>
            <button type="button" class="diary-btn diary-btn-secondary" id="detail-del" style="color:var(--danger);border-color:var(--danger)">${esc(t('entry.delete', 'Löschen'))}</button>
        </div>` : ""}`);
    div.querySelectorAll("[data-target-lang]").forEach((btn) => {
        btn.addEventListener("click", () => {
            switchEntryLang(entry, btn.getAttribute("data-target-lang"), div.querySelector("#detail-title"), div.querySelector("#detail-text"), btn);
        });
    });
    if (isLoggedIn) {
        div.querySelector("#detail-edit").addEventListener("click", () => openEntrySheet(entry));
        div.querySelector("#detail-del").addEventListener("click", (e) => deleteEntry(entry.id, e.target));
    }
    if (lang !== "de" && !hasTrustedField(entry, "title", lang)) {
        const detailTitleEl = div.querySelector("#detail-title");
        resolveTranslatedField(entry, "title", lang).then((translated) => {
            if (translated && detailTitleEl.isConnected) detailTitleEl.textContent = translated;
        }).catch(() => {});
    }
    const detailImgs = Array.from(div.querySelectorAll(".diary-entry-photos img"));
    detailImgs.forEach((img, idx) => {
        img.addEventListener("click", () => openLightbox(detailImgs.map((i) => i.src), idx));
    });
}

function paint() {
    const lang = currentLang();
    const feed = document.getElementById("diary-feed");
    const count = document.getElementById("diary-count");

    if (totalCount != null) count.textContent = totalCount + " " + pluralEntries(totalCount);
    else if (entriesLoaded) count.textContent = entries.length + " " + pluralEntries(entries.length);
    else count.textContent = t('count.loading', 'Lade Einträge …');

    // Solange die erste Seite nicht geladen ist, wird die Liste noch nicht gezeichnet –
    // sonst blitzt kurz „Keine Einträge“ auf, bevor die echten Daten da sind.
    if (!entriesLoaded) {
        document.getElementById("diary-fab").classList.toggle("show", isLoggedIn);
        renderAuthStatus();
        return;
    }

    const loadMoreHtml = hasMore
        ? `<div class="diary-load-more"><button type="button" class="diary-btn diary-btn-secondary" id="diary-load-more-btn" ${loadingMore ? "disabled" : ""}>${esc(loadingMore ? t('entries.loadingMore', 'Lade …') : t('entries.loadMore', 'Weitere Einträge laden'))}</button></div>`
        : "";
    feed.innerHTML = entries.length
        ? `<div class="diary-feed">${entries.map(renderEntry).join("")}</div>${loadMoreHtml}`
        : `<div class="diary-empty"><span class="shell">🐚</span><p>${esc(t('empty.text', 'Noch keine Einträge. Der erste Tag auf dem Camino beginnt hier.'))}</p></div>`;

    if (hasMore) {
        feed.querySelector("#diary-load-more-btn").addEventListener("click", () => {
            pageSize += PAGE_STEP;
            loadingMore = true;
            paint();
            subscribeEntries();
        });
    }

    feed.querySelectorAll("[data-open]").forEach(card => {
        card.addEventListener("click", (e) => {
            if (e.target.closest("[data-del],[data-edit],[data-target-lang],img")) return;
            const entry = entries.find(x => x.id === card.getAttribute("data-open"));
            if (entry) openDetailView(entry);
        });
    });
    feed.querySelectorAll("[data-edit]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const entry = entries.find(x => x.id === btn.getAttribute("data-edit"));
            if (entry) openEntrySheet(entry);
        });
    });
    feed.querySelectorAll("[data-del]").forEach(btn => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); deleteEntry(btn.getAttribute("data-del"), btn); });
    });
    feed.querySelectorAll("[data-target-lang]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-entry-id");
            const entry = entries.find(x => x.id === id);
            if (!entry) return;
            const targetLang = btn.getAttribute("data-target-lang");
            const titleEl = feed.querySelector(`[data-title-el="${CSS.escape(id)}"]`);
            const textEl = feed.querySelector(`[data-text-el="${CSS.escape(id)}"]`);
            switchEntryLang(entry, targetLang, titleEl, textEl, btn);
        });
    });
    feed.querySelectorAll(".diary-entry-photos").forEach(container => {
        const imgs = Array.from(container.querySelectorAll("img"));
        imgs.forEach((img, idx) => {
            img.addEventListener("click", (e) => {
                e.stopPropagation();
                openLightbox(imgs.map((i) => i.src), idx);
            });
        });
    });
    autoTranslateTitles(lang);

    document.getElementById("diary-fab").classList.toggle("show", isLoggedIn);
    renderAuthStatus();
}

// Titel („Tag 12“ usw.) sind kurz und werden deshalb beim Anzeigen automatisch
// übersetzt – anders als der ganze Text, der hinter den DE/EN/RU-Schaltflächen bleibt.
function autoTranslateTitles(lang) {
    if (lang === "de") return;
    for (const entry of entries) {
        if (hasTrustedField(entry, "title", lang)) continue;
        const titleEl = document.querySelector(`[data-title-el="${CSS.escape(entry.id)}"]`);
        if (!titleEl) continue;
        resolveTranslatedField(entry, "title", lang).then((translated) => {
            if (translated && titleEl.isConnected) titleEl.textContent = translated;
        }).catch(() => {});
    }
}

function renderAuthStatus() {
    const el = document.getElementById("diary-auth-status");
    if (isLoggedIn) {
        el.innerHTML = `${esc(t('auth.loggedIn', 'Angemeldet'))} · <button id="logout-btn">${esc(t('auth.logout', 'Abmelden'))}</button>`;
        document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));
    } else {
        el.innerHTML = `<button id="login-btn">${esc(t('auth.login', 'Anmelden'))}</button>`;
        document.getElementById("login-btn").addEventListener("click", openLoginSheet);
    }
}

// ---- Daten laden (Firestore) ----
function subscribeEntries() {
    if (unsubscribeEntries) unsubscribeEntries();
    unsubscribeEntries = onSnapshot(
        query(collection(db, "entries"), orderBy("createdAt", "desc"), limit(pageSize)),
        (snap) => {
            entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            entriesLoaded = true;
            loadingMore = false;
            hasMore = totalCount != null ? entries.length < totalCount : entries.length >= pageSize;
            paint();
        }, (err) => {
            loadingMore = false;
            document.getElementById("diary-count").textContent = t('count.error', 'Fehler beim Laden.');
            console.error(err);
        }
    );
}
subscribeEntries();

// Günstige Zählabfrage – liefert nur die Anzahl, nicht die (fotolastigen) Inhalte –
// damit die echte Gesamtzahl sofort angezeigt werden kann, unabhängig von pageSize.
getCountFromServer(collection(db, "entries")).then((snap) => {
    totalCount = snap.data().count;
    hasMore = entries.length < totalCount;
    paint();
}).catch((err) => console.error(err));

document.addEventListener("i18n:applied", () => { paint(); });

onAuthStateChanged(auth, (user) => {
    isLoggedIn = !!user;
    paint();
});

// ---- Dialoge: Anmeldung und Eintragsformular ----
function openBackdrop(innerHtml) {
    closeBackdrop();
    const div = document.createElement("div");
    div.className = "diary-backdrop show";
    div.id = "diary-backdrop";
    div.innerHTML = `<div class="diary-sheet">${innerHtml}</div>`;
    document.body.appendChild(div);
    div.addEventListener("click", (e) => { if (e.target === div) closeBackdrop(); });
    return div;
}
function closeBackdrop() {
    const b = document.getElementById("diary-backdrop");
    if (b) b.remove();
    draftPhotos = [];
}

function openLoginSheet() {
    const div = openBackdrop(`
        <h2>${esc(t('login.title', 'Anmelden'))}</h2>
        <div class="diary-field"><label for="login-email">${esc(t('login.email', 'E-Mail'))}</label><input type="email" id="login-email" autocomplete="email"></div>
        <div class="diary-field"><label for="login-pw">${esc(t('login.password', 'Passwort'))}</label><input type="password" id="login-pw" autocomplete="current-password"></div>
        <div class="diary-error" id="login-error"></div>
        <div class="diary-sheet-actions">
            <button type="button" class="diary-btn diary-btn-secondary" id="login-cancel">${esc(t('login.cancel', 'Abbrechen'))}</button>
            <button type="button" class="diary-btn diary-btn-primary" id="login-submit">${esc(t('login.submit', 'Anmelden'))}</button>
        </div>`);
    div.querySelector("#login-cancel").addEventListener("click", closeBackdrop);
    div.querySelector("#login-submit").addEventListener("click", async () => {
        const email = div.querySelector("#login-email").value.trim();
        const pw = div.querySelector("#login-pw").value;
        const btn = div.querySelector("#login-submit");
        const errEl = div.querySelector("#login-error");
        btn.disabled = true; btn.textContent = t('login.checking', 'Prüfe …');
        try {
            await signInWithEmailAndPassword(auth, email, pw);
            closeBackdrop();
        } catch (e) {
            errEl.textContent = t('login.failed', 'Anmeldung fehlgeschlagen — E-Mail oder Passwort falsch.');
            errEl.classList.add("show");
            btn.disabled = false; btn.textContent = t('login.submit', 'Anmelden');
        }
    });
}


function renderPreviewGrid(container) {
    container.innerHTML = draftPhotos.map((p, i) => `
        <div class="diary-preview-item"><img src="${p}" alt="${esc(t('preview.alt', 'Vorschau'))}">
        <button type="button" class="diary-preview-remove" data-remove="${i}" aria-label="${esc(t('preview.remove', 'Entfernen'))}">✕</button></div>`).join("");
    container.querySelectorAll("[data-remove]").forEach(btn => {
        btn.addEventListener("click", () => {
            draftPhotos.splice(Number(btn.getAttribute("data-remove")), 1);
            renderPreviewGrid(container);
        });
    });
}

function openEntrySheet(existingEntry) {
    const div = openBackdrop(`
        <h2>${existingEntry ? esc(t('entrySheet.editTitle', 'Tag bearbeiten')) : esc(t('entrySheet.title', 'Neuer Tag'))}</h2>
        <div class="diary-field"><label for="entry-title">${esc(t('entrySheet.titleLabel', 'Tag-Titel'))}</label>
        <input type="text" id="entry-title" placeholder="${esc(t('entrySheet.titlePlaceholder', 'z. B. Tag 3 – Barcelos'))}" value="${existingEntry ? esc(existingEntry.title || "") : ""}"></div>
        <div class="diary-field"><label for="entry-text">${esc(t('entrySheet.textLabel', 'Wie war dein Tag?'))}</label>
        <textarea id="entry-text" placeholder="${esc(t('entrySheet.textPlaceholder', 'Erzähl, wie es dir geht, was du gesehen hast …'))}">${existingEntry ? esc(existingEntry.text || "") : ""}</textarea></div>
        <div class="diary-field"><label>${esc(t('entrySheet.photosLabel', 'Fotos'))}</label>
            <label class="diary-photo-picker">${esc(t('entrySheet.addPhotos', '📷 Fotos hinzufügen'))}<input type="file" id="entry-photos" accept="image/*" multiple></label>
            <div class="diary-preview-grid" id="entry-preview"></div>
        </div>
        <div class="diary-field diary-manual-translations">
            <label>${esc(t('entrySheet.translationsLabel', 'Übersetzungen (von dir vorbereitet)'))}</label>
            <p class="diary-translate-hint">${esc(t('entrySheet.translationsHint', 'Leer lassen, wenn der Text oben schon in dieser Sprache ist.'))}</p>
            ${ALL_LANGS.map((l) => `
                <div class="diary-manual-translation-block">
                    <div class="diary-manual-translation-lang">${l.toUpperCase()}</div>
                    <input type="text" class="diary-manual-title" data-lang="${l}" placeholder="${esc(t('entrySheet.titleLabel', 'Tag-Titel'))}" value="${existingEntry ? esc(existingEntry["title_" + l] || "") : ""}">
                    <textarea class="diary-manual-text" data-lang="${l}" placeholder="${esc(t('entrySheet.textLabel', 'Wie war dein Tag?'))}">${existingEntry ? esc(existingEntry["text_" + l] || "") : ""}</textarea>
                </div>`).join("")}
        </div>
        <div class="diary-error" id="entry-error"></div>
        <div class="diary-sheet-actions">
            <button type="button" class="diary-btn diary-btn-secondary" id="entry-cancel">${esc(t('entrySheet.cancel', 'Abbrechen'))}</button>
            <button type="button" class="diary-btn diary-btn-primary" id="entry-save">${esc(t('entrySheet.save', 'Speichern'))}</button>
        </div>`);
    draftPhotos = existingEntry ? (existingEntry.photos || []).slice() : [];
    const previewEl = div.querySelector("#entry-preview");
    renderPreviewGrid(previewEl);
    div.querySelector("#entry-cancel").addEventListener("click", closeBackdrop);
    div.querySelector("#entry-photos").addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        for (const f of files) {
            try { draftPhotos.push(await resizeImage(f)); } catch (err) { /* Foto nicht lesbar – überspringen */ }
        }
        renderPreviewGrid(previewEl);
        e.target.value = "";
    });

    const titleInput = div.querySelector("#entry-title");
    const textArea = div.querySelector("#entry-text");

    div.querySelector("#entry-save").addEventListener("click", async () => {
        const title = titleInput.value.trim();
        const text = textArea.value.trim();
        const errEl = div.querySelector("#entry-error");
        const btn = div.querySelector("#entry-save");
        if (!title) { errEl.textContent = t('entrySheet.titleRequired', 'Bitte gib dem Tag einen Titel.'); errEl.classList.add("show"); return; }
        btn.disabled = true; btn.textContent = t('entrySheet.saving', 'Speichere …');
        const source = detectLang(title + " " + text);
        const payload = { title, text, photos: draftPhotos.slice(), origLang: source };
        // Übersetzungen werden hier von Hand geschrieben (nicht maschinell) und so
        // gespeichert, wie sie eingegeben wurden; ein leeres Feld löscht die Übersetzung.
        for (const tgt of ALL_LANGS) {
            const tTitle = div.querySelector(`.diary-manual-title[data-lang="${tgt}"]`).value.trim();
            const tText = div.querySelector(`.diary-manual-text[data-lang="${tgt}"]`).value.trim();
            payload["title_" + tgt] = tTitle || null;
            payload["text_" + tgt] = tText || null;
        }
        try {
            if (existingEntry) {
                await updateDoc(doc(db, "entries", existingEntry.id), payload);
            } else {
                payload.createdAt = serverTimestamp();
                await addDoc(collection(db, "entries"), payload);
            }
            closeBackdrop();
        } catch (e) {
            errEl.textContent = t('entrySheet.saveFailed', 'Speichern fehlgeschlagen: ') + e.message;
            errEl.classList.add("show");
            btn.disabled = false; btn.textContent = t('entrySheet.save', 'Speichern');
        }
    });
}

document.getElementById("diary-fab").addEventListener("click", () => openEntrySheet(null));

// ---- Lightbox: Wischen nach links/rechts (oder Pfeiltasten) blättert durch die Fotos eines Eintrags ----
let lightboxPhotos = [];
let lightboxIndex = 0;

function showLightboxImage() {
    document.getElementById("diary-lightbox-img").src = lightboxPhotos[lightboxIndex];
}
function lightboxNext() {
    if (lightboxPhotos.length < 2) return;
    lightboxIndex = (lightboxIndex + 1) % lightboxPhotos.length;
    showLightboxImage();
}
function lightboxPrev() {
    if (lightboxPhotos.length < 2) return;
    lightboxIndex = (lightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length;
    showLightboxImage();
}
function openLightbox(photos, index) {
    lightboxPhotos = photos;
    lightboxIndex = index;
    const multi = photos.length > 1;
    document.getElementById("lightbox-prev").style.display = multi ? "flex" : "none";
    document.getElementById("lightbox-next").style.display = multi ? "flex" : "none";
    showLightboxImage();
    document.getElementById("diary-lightbox").classList.add("show");
}

const lightboxEl = document.getElementById("diary-lightbox");
document.getElementById("lightbox-close").addEventListener("click", (e) => {
    e.stopPropagation();
    lightboxEl.classList.remove("show");
});
document.getElementById("lightbox-prev").addEventListener("click", (e) => { e.stopPropagation(); lightboxPrev(); });
document.getElementById("lightbox-next").addEventListener("click", (e) => { e.stopPropagation(); lightboxNext(); });
lightboxEl.addEventListener("click", function (e) { if (e.target === this) this.classList.remove("show"); });

let lightboxTouchStartX = null;
let lightboxTouchMoved = false;
lightboxEl.addEventListener("touchstart", (e) => {
    lightboxTouchStartX = e.changedTouches[0].clientX;
    lightboxTouchMoved = false;
}, { passive: true });
lightboxEl.addEventListener("touchmove", () => { lightboxTouchMoved = true; }, { passive: true });
lightboxEl.addEventListener("touchend", (e) => {
    if (lightboxTouchStartX == null) return;
    const dx = e.changedTouches[0].clientX - lightboxTouchStartX;
    if (lightboxTouchMoved && Math.abs(dx) > 40) {
        if (dx < 0) lightboxNext(); else lightboxPrev();
        e.preventDefault();
    }
    lightboxTouchStartX = null;
});
document.addEventListener("keydown", (e) => {
    if (!lightboxEl.classList.contains("show")) return;
    if (e.key === "ArrowRight") lightboxNext();
    else if (e.key === "ArrowLeft") lightboxPrev();
    else if (e.key === "Escape") lightboxEl.classList.remove("show");
});

renderAuthStatus();
