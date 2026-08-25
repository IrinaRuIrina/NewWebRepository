(function () {
    "use strict";
    var STORAGE_KEY = "site-lang";

    function getLang() {
        var saved = null;
        try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
        if (saved && window.I18N && window.I18N[saved]) return saved;
        return "de";
    }

    function apply(lang) {
        if (!window.I18N || !window.I18N[lang]) return;
        var dict = window.I18N[lang];
        document.documentElement.lang = lang;

        document.querySelectorAll("[data-i18n]").forEach(function (el) {
            var key = el.getAttribute("data-i18n");
            if (dict[key] != null) el.textContent = dict[key];
        });
        document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
            var key = el.getAttribute("data-i18n-html");
            if (dict[key] != null) el.innerHTML = dict[key];
        });
        document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
            var key = el.getAttribute("data-i18n-placeholder");
            if (dict[key] != null) el.setAttribute("placeholder", dict[key]);
        });
        document.querySelectorAll("[data-i18n-aria-label]").forEach(function (el) {
            var key = el.getAttribute("data-i18n-aria-label");
            if (dict[key] != null) el.setAttribute("aria-label", dict[key]);
        });
        document.querySelectorAll("[data-i18n-alt]").forEach(function (el) {
            var key = el.getAttribute("data-i18n-alt");
            if (dict[key] != null) el.setAttribute("alt", dict[key]);
        });
        document.querySelectorAll(".lang-switch [data-lang]").forEach(function (btn) {
            btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
        });
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
        document.dispatchEvent(new CustomEvent("i18n:applied", { detail: { lang: lang } }));
    }

    window.I18N_setLang = apply;
    window.I18N_getLang = getLang;

    document.addEventListener("DOMContentLoaded", function () { apply(getLang()); });
})();
