(() => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const pairingCode = params.get('pair')
  if (pairingCode && /^[A-Za-z0-9_-]{32,128}$/.test(pairingCode)) {
    Object.defineProperty(window, '__ULTIMATE_SIM_RECEIVER_PAIRING__', {
      value: pairingCode,
      configurable: true,
      enumerable: false,
      writable: true
    })
  }
  const cleanUrl = new URL(window.location.href)
  for (const secretName of ['token', 'password', 'pair', 'pairingCode']) {
    cleanUrl.searchParams.delete(secretName)
  }
  cleanUrl.hash = ''
  const cleanLocation = `${cleanUrl.pathname}${cleanUrl.search}`
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== cleanLocation) {
    window.history.replaceState(null, document.title, cleanLocation)
  }
})()
