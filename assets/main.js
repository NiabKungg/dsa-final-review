/* DSA Final Review — site behaviour */
(function () {
  "use strict";

  /* ---------- mark wide diagrams so they scroll instead of shrinking on mobile ---------- */
  document.querySelectorAll("figure.diagram svg").forEach(function (svg) {
    var vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width >= 600) svg.classList.add("wide");
  });

  /* ---------- theme ---------- */
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem("dsa-theme"); } catch (e) {}
  if (saved === "dark" || (!saved && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    root.setAttribute("data-theme", "dark");
  }
  function syncThemeButtons() {
    var dark = root.getAttribute("data-theme") === "dark";
    document.querySelectorAll("[data-action='toggle-theme']").forEach(function (b) {
      b.textContent = dark ? "☀️" : "🌙";
    });
  }
  function toggleTheme() {
    var dark = root.getAttribute("data-theme") === "dark";
    if (dark) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", "dark");
    try { localStorage.setItem("dsa-theme", dark ? "light" : "dark"); } catch (e) {}
    syncThemeButtons();
  }
  document.addEventListener("DOMContentLoaded", syncThemeButtons);
  syncThemeButtons();
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-action='toggle-theme']");
    if (t) toggleTheme();
  });

  /* ---------- reading progress ---------- */
  var bar = document.getElementById("progress");
  function onScroll() {
    if (!bar) return;
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + "%";
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- mobile TOC toggle ---------- */
  document.querySelectorAll("aside.toc .toc-head").forEach(function (head) {
    head.addEventListener("click", function () {
      head.parentElement.classList.toggle("open");
    });
  });

  /* ---------- highlight current section in TOC ---------- */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll("aside.toc a[href^='#']"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var map = {};
    tocLinks.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      var el = document.getElementById(id);
      if (el) map[id] = a;
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && map[en.target.id]) {
          tocLinks.forEach(function (a) { a.style.background = ""; a.style.color = ""; a.style.fontWeight = ""; });
          var a = map[en.target.id];
          a.style.background = "var(--accent-soft)";
          a.style.color = "var(--accent-ink)";
          a.style.fontWeight = "700";
        }
      });
    }, { rootMargin: "-70px 0px -65% 0px" });
    Object.keys(map).forEach(function (id) { io.observe(document.getElementById(id)); });
  }

  /* ---------- MCQ ---------- */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".mcq button.opt");
    if (!btn) return;
    var mcq = btn.closest(".mcq");
    if (mcq.getAttribute("data-state") === "answered") return;
    mcq.setAttribute("data-state", "answered");
    var isCorrect = btn.getAttribute("data-correct") === "1";
    btn.classList.add(isCorrect ? "correct" : "wrong");
    mcq.querySelectorAll("button.opt").forEach(function (b) {
      if (b.getAttribute("data-correct") === "1") b.classList.add("correct");
    });
  });

  /* ---------- show / hide all solutions ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-action='toggle-solutions']");
    if (!t) return;
    var open = t.getAttribute("data-open") === "1";
    document.querySelectorAll("details.sol").forEach(function (d) { d.open = open; });
    document.querySelectorAll("[data-action='toggle-solutions']").forEach(function (b) {
      b.setAttribute("data-open", open ? "0" : "1");
      b.textContent = open ? "ซ่อนเฉลยทั้งหมด" : "เปิดเฉลยทั้งหมด";
    });
  });
})();
