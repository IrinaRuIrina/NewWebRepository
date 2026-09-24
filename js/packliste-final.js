// Endgültige Packliste: Lightbox zum Durchblättern der Fotogalerie
// (Klick auf ein Foto, dann Pfeiltasten/Schaltflächen, Escape oder Klick daneben schließt).
(function () {
    const items = Array.from(document.querySelectorAll('.pf-gallery-item'));
    const captions = Array.from(document.querySelectorAll('.pf-gallery-cap'));
    const lightbox = document.getElementById('pf-lightbox');
    const lightboxImg = document.getElementById('pf-lightbox-img');
    const lightboxCap = document.getElementById('pf-lightbox-cap');
    let current = 0;

    function show(index) {
        // Modulo sorgt dafür, dass nach dem letzten Bild wieder das erste kommt
        current = (index + items.length) % items.length;
        const img = items[current].querySelector('img');
        lightboxImg.src = img.src;
        lightboxImg.alt = img.alt;
        lightboxCap.textContent = captions[current] ? captions[current].textContent : '';
    }

    function open(index) {
        show(index);
        lightbox.classList.add('show');
    }

    function close() {
        lightbox.classList.remove('show');
    }

    items.forEach((item, index) => {
        item.addEventListener('click', () => open(index));
    });

    document.getElementById('pf-lightbox-prev').addEventListener('click', (e) => { e.stopPropagation(); show(current - 1); });
    document.getElementById('pf-lightbox-next').addEventListener('click', (e) => { e.stopPropagation(); show(current + 1); });
    document.getElementById('pf-lightbox-close').addEventListener('click', close);
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) close(); });

    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('show')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') show(current - 1);
        if (e.key === 'ArrowRight') show(current + 1);
    });
})();
