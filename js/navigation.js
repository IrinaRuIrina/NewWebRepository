// Gemeinsames Verhalten der Navigation auf allen öffentlichen Seiten:
// mobiles Menü, Hintergrund der Navigationsleiste beim Scrollen und die
// Schaltflächen „Nach oben“ / „Nach unten“ (nur wenn auf der Seite vorhanden).
(function () {
    const toggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');
    const navbar = document.querySelector('.navbar');
    const backToTop = document.querySelector('.back-to-top');
    const scrollToBottom = document.querySelector('.scroll-to-bottom');

    // Mobiles Menü auf- und zuklappen
    toggle.addEventListener('click', () => {
        navLinks.classList.toggle('active');
        toggle.classList.toggle('active');
    });

    // Menü schließen, sobald ein Link angeklickt wurde
    document.querySelectorAll('.nav-links a').forEach((link) => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('active');
            toggle.classList.remove('active');
        });
    });

    function onScroll() {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
        if (backToTop) backToTop.classList.toggle('show', window.scrollY > 500);
        if (scrollToBottom) {
            const remaining = document.body.scrollHeight - (window.scrollY + window.innerHeight);
            scrollToBottom.classList.toggle('show', remaining > 500);
        }
    }

    window.addEventListener('scroll', onScroll);
    onScroll();

    if (scrollToBottom) {
        scrollToBottom.addEventListener('click', () => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        });
    }
})();
