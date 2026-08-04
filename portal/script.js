// ── config: bump version + update server when releasing ──
  var VERSION = '1.0.0'
  var BASE = 'https://brick-works.xiaolannet.top'
  var FILES = {
    win: 'brick-works-' + VERSION + '-setup.exe',
    mac: 'BrickWorks-' + VERSION + '.dmg',
    linux: 'brick-works-' + VERSION + '.AppImage'
  }

  document.getElementById('ver').textContent = 'v' + VERSION
  document.getElementById('dl-win').textContent = FILES.win
  document.getElementById('dl-mac').textContent = FILES.mac
  document.getElementById('dl-linux').textContent = FILES.linux
  document.getElementById('dl-win-link').href = BASE + '/' + FILES.win
  document.getElementById('dl-mac-link').href = BASE + '/' + FILES.mac
  document.getElementById('dl-linux-link').href = BASE + '/' + FILES.linux
  document.getElementById('year').textContent = new Date().getFullYear()

  // ── reveal on scroll ──
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in')
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.12 })
  document.querySelectorAll('.reveal').forEach(function (el) { observer.observe(el) })

  // ── cursor glow ──
  var glow = document.createElement('div')
  glow.style.cssText =
    'position:fixed;z-index:0;pointer-events:none;width:520px;height:520px;border-radius:50%;' +
    'background:radial-gradient(closest-side,rgba(139,92,246,0.10),transparent);' +
    'transform:translate(-50%,-50%);transition:opacity .3s;mix-blend-mode:screen;'
  document.body.appendChild(glow)
  var hasMouse = window.matchMedia('(hover: hover)').matches
  if (!hasMouse) { glow.style.display = 'none' }
  window.addEventListener('pointermove', function (e) {
    glow.style.left = e.clientX + 'px'
    glow.style.top = e.clientY + 'px'
  })
