// Melhoria progressiva: o site funciona sem JavaScript; aqui só o menu móvel.
(function () {
  document.documentElement.classList.add("js");
  var btn = document.querySelector("[data-nav-toggle]");
  var nav = document.getElementById("menu");
  if (!btn || !nav) return;
  function set(open) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.querySelector(".sr-only").textContent = open ? "Fechar menu" : "Abrir menu";
    nav.classList.toggle("open", open);
  }
  btn.addEventListener("click", function () { set(btn.getAttribute("aria-expanded") !== "true"); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { set(false); btn.focus(); } });
  nav.addEventListener("click", function (e) { if (e.target.closest("a")) set(false); });
})();
