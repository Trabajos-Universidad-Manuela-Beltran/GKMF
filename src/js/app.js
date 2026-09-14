(function () {
  'use strict';

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.remove('active');
    });
    var target = document.getElementById(name);
    if (target) {
      target.classList.add('active');
      target.scrollTop = 0;
    }
  }

  window.showScreen = showScreen;

  setTimeout(function () {
    showScreen('dashboard');
  }, 2700);
}());
