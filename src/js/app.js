(function () {
  'use strict';

  var SPLASH_DURATION_MS = 2700;

  var NAV_INDEX = { dashboard: 0, savings: 1, education: 2 };

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.remove('active');
      s.inert = true;
      s.setAttribute('aria-hidden', 'true');
    });

    var target = document.getElementById(name);
    if (target) {
      target.classList.add('active');
      target.inert = false;
      target.removeAttribute('aria-hidden');
      target.scrollTop = 0;
    }

    var nav = document.getElementById('main-nav');
    if (nav) {
      var isMainScreen = Object.prototype.hasOwnProperty.call(NAV_INDEX, name);
      nav.hidden = !isMainScreen;
      if (isMainScreen) {
        nav.querySelectorAll('.nav-item').forEach(function (btn, i) {
          var active = i === NAV_INDEX[name];
          btn.classList.toggle('active', active);
          if (active) {
            btn.setAttribute('aria-current', 'page');
          } else {
            btn.removeAttribute('aria-current');
          }
        });
      }
    }
  }

  window.showScreen = showScreen;

  document.querySelectorAll('.screen:not(.active)').forEach(function (s) {
    s.inert = true;
    s.setAttribute('aria-hidden', 'true');
  });

  setTimeout(function () {
    showScreen('dashboard');
  }, SPLASH_DURATION_MS);
}());
