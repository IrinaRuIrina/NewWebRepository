// Private Notizen: nur nach Anmeldung sichtbar. Notizen mit Kategorie, Text und
// Fotos anlegen, filtern, bearbeiten und löschen (gespeichert in Firestore).
import {
    collection, addDoc, updateDoc, deleteDoc, doc,
    onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
    signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { db, auth } from "./gemeinsam/firebase.js";
import { t, esc, formatDate, resizeImage } from "./gemeinsam/hilfsfunktionen.js";

// Kategorien werden auf Deutsch gespeichert; CATEGORY_KEY verweist auf den Übersetzungsschlüssel.
const CATEGORIES = ["Dankbarkeit", "Traum", "Buchauszug", "Gedanken zu Büchern", "Sonstiges"];
const CATEGORY_KEY = {
    "Dankbarkeit": "cat.dankbarkeit", "Traum": "cat.traum", "Buchauszug": "cat.buchauszug",
    "Gedanken zu Büchern": "cat.gedanken", "Sonstiges": "cat.sonstiges"
};
let notes = [];
let activeFilter = "Alle";
let draftPhotos = [];
let unsubscribe = null;

function categoryLabel(cat) {
    return cat === "Alle" ? t("cat.alle", "Alle") : t(CATEGORY_KEY[cat], cat);
}

// ---- Anzeige: Filter und Notizliste ----
function renderFilters() {
    const el = document.getElementById("filters");
    const all = ["Alle", ...CATEGORIES];
    el.innerHTML = all.map(c =>
        `<button class="filter-chip ${c === activeFilter ? "active" : ""}" data-filter="${esc(c)}">${esc(categoryLabel(c))}</button>`).join("");
    el.querySelectorAll("[data-filter]").forEach(btn => {
        btn.addEventListener("click", () => { activeFilter = btn.getAttribute("data-filter"); renderFilters(); renderFeed(); });
    });
}

document.addEventListener("i18n:applied", () => { renderFilters(); renderFeed(); });

function renderFeed() {
    const feed = document.getElementById("feed");
    const shown = activeFilter === "Alle" ? notes : notes.filter(n => n.category === activeFilter);
    if (!shown.length) {
        feed.innerHTML = `<div class="note-empty">${esc(t('empty.text', 'Noch keine Notizen'))}${activeFilter !== "Alle" ? esc(t('empty.inCategory', ' in dieser Kategorie')) : ""}.</div>`;
        return;
    }
    feed.innerHTML = `<div class="note-feed">${shown.map(n => `
        <article class="note" data-open="${esc(n.id)}">
            <div class="note-head">
                <div><span class="note-cat">${esc(categoryLabel(n.category))}</span><div class="note-date">${esc(formatDate(n.createdAt))}</div></div>
                <div class="note-actions">
                    <button class="note-edit" data-edit="${esc(n.id)}" aria-label="${esc(t('note.edit', 'Bearbeiten'))}">✏️</button>
                    <button class="note-del" data-del="${esc(n.id)}" aria-label="${esc(t('note.delete', 'Löschen'))}">✕</button>
                </div>
            </div>
            ${n.text ? `<p class="note-text-preview">${esc(n.text)}</p><p class="note-more">${esc(t('note.readMore', 'Weiterlesen →'))}</p>` : ""}
            ${(n.photos || []).length ? `<div class="note-photos">${n.photos.map(p => `<img src="${p}" alt="${esc(t('photo.alt', 'Foto'))}">`).join("")}</div>` : ""}
        </article>`).join("")}</div>`;

    feed.querySelectorAll("[data-open]").forEach(card => {
        card.addEventListener("click", (e) => {
            if (e.target.closest("[data-del],[data-edit],img")) return;
            const note = notes.find(n => n.id === card.getAttribute("data-open"));
            if (note) openDetailView(note);
        });
    });
    feed.querySelectorAll("[data-edit]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const note = notes.find(n => n.id === btn.getAttribute("data-edit"));
            if (note) openNoteForm(note);
        });
    });
    feed.querySelectorAll("[data-del]").forEach(btn => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); deleteNote(btn.getAttribute("data-del"), btn); });
    });
    feed.querySelectorAll(".note-photos img").forEach(img => {
        img.addEventListener("click", (e) => {
            e.stopPropagation();
            document.getElementById("lightbox-img").src = img.src;
            document.getElementById("lightbox").classList.add("show");
        });
    });
}

async function deleteNote(id, triggerBtn) {
    if (!confirm(t('note.delete.confirm', 'Notiz wirklich löschen?'))) return;
    if (triggerBtn) triggerBtn.disabled = true;
    try {
        await deleteDoc(doc(db, "private_notes", id));
        closeBackdrop();
    } catch (e) {
        alert(t('note.delete.failed', 'Löschen fehlgeschlagen: ') + e.message);
        if (triggerBtn) triggerBtn.disabled = false;
    }
}

function openDetailView(note) {
    const photos = (note.photos || []).map(p => `<img src="${p}" alt="${esc(t('photo.alt', 'Foto'))}">`).join("");
    const div = openBackdrop(`
        <span class="detail-cat">${esc(categoryLabel(note.category))}</span>
        <div class="detail-date">${esc(formatDate(note.createdAt))}</div>
        ${note.text ? `<p class="detail-text">${esc(note.text)}</p>` : ""}
        ${photos ? `<div class="note-photos" style="margin-top:1rem">${photos}</div>` : ""}
        <div class="sheet-actions">
            <button type="button" class="btn-secondary" id="detail-edit">${esc(t('note.edit', 'Bearbeiten'))}</button>
            <button type="button" class="btn-secondary" id="detail-del" style="color:var(--danger);border-color:var(--danger)">${esc(t('note.delete', 'Löschen'))}</button>
        </div>`);
    div.querySelector("#detail-edit").addEventListener("click", () => openNoteForm(note));
    div.querySelector("#detail-del").addEventListener("click", (e) => deleteNote(note.id, e.target));
    div.querySelectorAll(".note-photos img").forEach(img => {
        img.addEventListener("click", () => {
            document.getElementById("lightbox-img").src = img.src;
            document.getElementById("lightbox").classList.add("show");
        });
    });
}

// ---- Daten laden (Firestore) und Anmeldung ----
function startListening() {
    if (unsubscribe) return;
    unsubscribe = onSnapshot(query(collection(db, "private_notes"), orderBy("createdAt", "desc")), (snap) => {
        notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderFeed();
    }, (err) => {
        document.getElementById("feed").innerHTML = `<div class="note-empty">${esc(t('count.error', 'Fehler beim Laden.'))}</div>`;
        console.error(err);
    });
}
function stopListening() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    notes = [];
}

onAuthStateChanged(auth, (user) => {
    const gate = document.getElementById("gate");
    const appEl = document.getElementById("app");
    const fab = document.getElementById("fab");
    if (user) {
        gate.style.display = "none";
        appEl.classList.add("show");
        fab.style.display = "block";
        renderFilters();
        startListening();
    } else {
        gate.style.display = "flex";
        appEl.classList.remove("show");
        fab.style.display = "none";
        stopListening();
    }
});

document.getElementById("g-submit").addEventListener("click", async () => {
    const email = document.getElementById("g-email").value.trim();
    const pw = document.getElementById("g-pw").value;
    const btn = document.getElementById("g-submit");
    const errEl = document.getElementById("g-error");
    btn.disabled = true; btn.textContent = t('gate.checking', 'Prüfe …');
    try { await signInWithEmailAndPassword(auth, email, pw); }
    catch (e) {
        errEl.textContent = t('gate.failed', 'Anmeldung fehlgeschlagen — E-Mail oder Passwort falsch.');
        errEl.classList.add("show");
    }
    btn.disabled = false; btn.textContent = t('gate.submit', 'Anmelden');
});
document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

// ---- Dialoge und Notizformular ----
function openBackdrop(html) {
    closeBackdrop();
    const div = document.createElement("div");
    div.className = "backdrop show";
    div.id = "note-backdrop";
    div.innerHTML = `<div class="sheet">${html}</div>`;
    document.body.appendChild(div);
    div.addEventListener("click", (e) => { if (e.target === div) closeBackdrop(); });
    return div;
}
function closeBackdrop() {
    const b = document.getElementById("note-backdrop");
    if (b) b.remove();
    draftPhotos = [];
}

function renderPreviewGrid(container) {
    container.innerHTML = draftPhotos.map((p, i) => `
        <div class="preview-item"><img src="${p}" alt="${esc(t('preview.alt', 'Vorschau'))}">
        <button type="button" class="preview-remove" data-remove="${i}">✕</button></div>`).join("");
    container.querySelectorAll("[data-remove]").forEach(btn => {
        btn.addEventListener("click", () => { draftPhotos.splice(Number(btn.getAttribute("data-remove")), 1); renderPreviewGrid(container); });
    });
}

function openNoteForm(existingNote) {
    const div = openBackdrop(`
        <h2>${existingNote ? esc(t('form.editTitle', 'Notiz bearbeiten')) : esc(t('form.newTitle', 'Neue Notiz'))}</h2>
        <div class="field"><label for="n-cat">${esc(t('form.category', 'Kategorie'))}</label>
            <select id="n-cat">${CATEGORIES.map(c => `<option value="${esc(c)}" ${existingNote && existingNote.category === c ? "selected" : ""}>${esc(categoryLabel(c))}</option>`).join("")}</select>
        </div>
        <div class="field"><label for="n-text">${esc(t('form.text', 'Text'))}</label><textarea id="n-text" placeholder="${esc(t('form.textPlaceholder', 'Schreib, was dir gerade wichtig ist …'))}">${existingNote ? esc(existingNote.text || "") : ""}</textarea></div>
        <div class="field"><label>${esc(t('form.photoLabel', 'Foto (optional)'))}</label>
            <label class="photo-picker">${esc(t('form.addPhoto', '📷 Foto hinzufügen'))}<input type="file" id="n-photos" accept="image/*" multiple></label>
            <div class="preview-grid" id="n-preview"></div>
        </div>
        <p class="error" id="n-error"></p>
        <div class="sheet-actions">
            <button type="button" class="btn-secondary" id="n-cancel">${esc(t('form.cancel', 'Abbrechen'))}</button>
            <button type="button" class="btn btn-primary" id="n-save">${esc(t('form.save', 'Speichern'))}</button>
        </div>`);
    draftPhotos = existingNote ? (existingNote.photos || []).slice() : [];
    const previewEl = div.querySelector("#n-preview");
    renderPreviewGrid(previewEl);
    div.querySelector("#n-cancel").addEventListener("click", closeBackdrop);
    div.querySelector("#n-photos").addEventListener("change", async (e) => {
        for (const f of Array.from(e.target.files || [])) {
            try { draftPhotos.push(await resizeImage(f)); } catch (err) { /* Foto nicht lesbar – überspringen */ }
        }
        renderPreviewGrid(previewEl);
        e.target.value = "";
    });
    div.querySelector("#n-save").addEventListener("click", async () => {
        const category = div.querySelector("#n-cat").value;
        const text = div.querySelector("#n-text").value.trim();
        const errEl = div.querySelector("#n-error");
        const btn = div.querySelector("#n-save");
        if (!text && !draftPhotos.length) { errEl.textContent = t('form.required', 'Bitte Text oder Foto hinzufügen.'); errEl.classList.add("show"); return; }
        btn.disabled = true; btn.textContent = t('form.saving', 'Speichere …');
        try {
            if (existingNote) {
                await updateDoc(doc(db, "private_notes", existingNote.id), { category, text, photos: draftPhotos.slice() });
            } else {
                await addDoc(collection(db, "private_notes"), { category, text, photos: draftPhotos.slice(), createdAt: serverTimestamp() });
            }
            closeBackdrop();
        } catch (e) {
            errEl.textContent = t('form.saveFailed', 'Speichern fehlgeschlagen: ') + e.message;
            errEl.classList.add("show");
            btn.disabled = false; btn.textContent = t('form.save', 'Speichern');
        }
    });
}

document.getElementById("fab").addEventListener("click", () => openNoteForm(null));

document.getElementById("lightbox").addEventListener("click", function () { this.classList.remove("show"); });
