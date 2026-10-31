// Pede confirmação antes de ações destrutivas (formulários com data-confirm).
document.addEventListener("submit", function (e) {
  var msg = e.target && e.target.getAttribute && e.target.getAttribute("data-confirm");
  if (msg && !window.confirm(msg)) e.preventDefault();
});
