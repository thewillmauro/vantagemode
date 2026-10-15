/* Theme before paint; same key as the homepage. External because the page CSP blocks inline scripts. */
try { var t = localStorage.getItem('vm-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
