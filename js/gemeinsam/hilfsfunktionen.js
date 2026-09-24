// Kleine Hilfsfunktionen, die Tagebuch und Notizen gemeinsam nutzen.

// Aktuell gewählte Seitensprache (siehe js/i18n.js), Standard ist Deutsch.
export function currentLang() {
    return (window.I18N_getLang && window.I18N_getLang()) || "de";
}

// Übersetzten Text zu einem Schlüssel holen; fehlt er, wird der Fallback verwendet.
export function t(key, fallback) {
    const dict = (window.I18N && window.I18N[currentLang()]) || {};
    return dict[key] != null ? dict[key] : fallback;
}

// Maskiert HTML-Sonderzeichen, damit Benutzertexte sicher in HTML eingesetzt werden können.
export function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Formatiert einen Firestore-Zeitstempel (oder ein Datum) passend zur Seitensprache.
export function formatDate(timestamp) {
    try {
        const date = timestamp && timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const lang = currentLang();
        const locale = lang === "en" ? "en-GB" : lang === "ru" ? "ru-RU" : "de-DE";
        return date.toLocaleString(locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
        return "";
    }
}

// Verkleinert ein hochgeladenes Foto (max. 1100 px Kantenlänge) und liefert es als
// JPEG-Data-URL zurück. Die Fotos werden so direkt im Firestore-Dokument gespeichert.
export function resizeImage(file) {
    const MAX_DIMENSION = 1100;
    const JPEG_QUALITY = 0.62;

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read-failed"));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error("decode-failed"));
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    if (width > height) {
                        height = Math.round(height * (MAX_DIMENSION / width));
                        width = MAX_DIMENSION;
                    } else {
                        width = Math.round(width * (MAX_DIMENSION / height));
                        height = MAX_DIMENSION;
                    }
                }
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                canvas.getContext("2d").drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}
