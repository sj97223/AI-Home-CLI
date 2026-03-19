// Theme and language initialization
(function() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;
  const savedLang = localStorage.getItem('lang') || 'zh';
  document.documentElement.lang = savedLang;
})();
