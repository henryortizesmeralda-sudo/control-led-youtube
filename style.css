// ============================================================================
// DETECCIÓN DE SISTEMA OPERATIVO (PC vs ANDROID) + MANIFEST PWA DINÁMICO
// ============================================================================
const isAndroid = /Android/i.test(navigator.userAgent);
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const supportsDisplayAudio = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !isMobile;

// Inyecta manifiesto PWA para que "Añadir a pantalla de inicio" en Android abra sin barra de navegador
(function injectPwaManifest() {
    const manifest = {
        name: "LED LAMP Pro",
        short_name: "LED LAMP",
        start_url: ".",
        display: "standalone",
        background_color: "#0b0c10",
        theme_color: "#0b0c10"
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(blob);
    document.head.appendChild(link);
})();

let connectedLights = []; // { device, char, queue, processing }
let isLightsOn = true;
let isManualDisconnect = false;
let currentRGB = { r: 0, g: 255, b: 136 };
let currentBrightness = 100;
let activeModeInterval = null;
let activeModeName = null;
let timerInterval = null;
let timerRemainingSec = 0;

let audioContext = null;
let analyser = null;
let dataArray = null;
let currentStream = null;
let wakeLock = null;
let isSyncing = false;
let lastSendTime = 0;
let player = null;

const ALL_LED_SERVICES = [
    '0000ffe0-0000-1000-8000-00805f9b34fb', // LEDBLE-00 / LED LAMP
    '0000ffe5-0000-1000-8000-00805f9b34fb', // Triones / LEDBLE clásico
    '0000fff0-0000-1000-8000-00805f9b34fb', // ELK-BLEDOM / MELK
    '0000ffd0-0000-1000-8000-00805f9b34fb', // Triones
    '0000ffd5-0000-1000-8000-00805f9b34fb', // Triones / Zengge
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ff12-0000-1000-8000-00805f9b34fb',
    '0000ae00-0000-1000-8000-00805f9b34fb',
    '00001800-0000-1000-8000-00805f9b34fb',
    '00001801-0000-1000-8000-00805f9b34fb',
    '0000180a-0000-1000-8000-00805f9b34fb'
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// REFERENCIAS DOM Y NAVEGACIÓN POR PESTAÑAS
// ============================================================================
const logDiv = document.getElementById('log');
const ambientGlow = document.getElementById('ambientGlow');
const protocolSelect = document.getElementById('protocolSelect');
const btnMasterPower = document.getElementById('btnMasterPower');
const btnDevicesModal = document.getElementById('btnDevicesModal');
const devicesDrawer = document.getElementById('devicesDrawer');
const deviceListDiv = document.getElementById('deviceList');
const connDot = document.getElementById('connDot');
const connCountText = document.getElementById('connCountText');

function log(msg) {
    logDiv.innerHTML += `> ${msg}<br>`;
    logDiv.scrollTop = logDiv.scrollHeight;
}

// Cambio de pestañas inferiores
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

// Abrir / cerrar lista de dispositivos arriba
btnDevicesModal.addEventListener('click', () => {
    devicesDrawer.style.display = devicesDrawer.style.display === 'none' ? 'block' : 'none';
});

// Configuración inicial por SO
(function initPlatform() {
    if (!window.isSecureContext) {
        document.getElementById('securityWarning').style.display = 'block';
    }

    const platformTag = document.getElementById('platformTag');
    if (isAndroid) {
        platformTag.textContent = 'ANDROID';
        document.getElementById('btnSystemAudio').style.display = 'none';
        document.getElementById('musicHelper').textContent = 'Activa el micrófono (optimizado sin filtro de ruido) y mantén Ubicación (GPS) y Bluetooth encendidos.';
    } else {
        platformTag.textContent = 'PC';
    }
})();

// ============================================================================
// WAKE LOCK (EVITA SUSPENSIÓN EN ANDROID)
// ============================================================================
async function requestScreenWakeLock() {
    try {
        if ('wakeLock' in navigator && !wakeLock) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
    } catch (e) {}
}

function releaseScreenWakeLock() {
    if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
}

// ============================================================================
// COLA GATT SERIALIZADA (EVITA ERROR 133 EN ANDROID Y CORTES EN WINDOWS)
// ============================================================================
function enqueueWrite(light, bytes, isPriority = false) {
    if (!light || !light.device.gatt.connected) return Promise.resolve();
    if (!isPriority && light.queue.length > 1) return Promise.resolve();

    return new Promise((resolve) => {
        light.queue.push({ bytes, resolve });
        processLightQueue(light);
    });
}

async function processLightQueue(light) {
    if (light.processing || light.queue.length === 0) return;
    light.processing = true;

    while (light.queue.length > 0) {
        const { bytes, resolve } = light.queue.shift();
        try {
            if (light.device.gatt.connected) {
                if (light.char.properties.writeWithoutResponse) {
                    await light.char.writeValueWithoutResponse(bytes);
                } else {
                    await light.char.writeValue(bytes);
                }
            }
        } catch (err) {
            try {
                if (light.device.gatt.connected) await light.char.writeValue(bytes);
            } catch (e) {}
        }
        await sleep(isAndroid ? 45 : 35);
        resolve();
    }

    light.processing = false;
}

async function sendToAllLights(bytes, isPriority = false) {
    await Promise.all(connectedLights.map(light => enqueueWrite(light, bytes, isPriority)));
}

// ============================================================================
// AUTO-CONEXIÓN Y GESTIÓN DE DISPOSITIVOS BLUETOOTH
// ============================================================================
window.addEventListener('DOMContentLoaded', () => {
    drawColorWheel();
    renderDiySwatches();
    setTimeout(autoConnectSavedLights, 400);
});

async function autoConnectSavedLights() {
    if (!navigator.bluetooth || typeof navigator.bluetooth.getDevices !== 'function') return;

    try {
        const saved = await navigator.bluetooth.getDevices();
        if (!saved || saved.length === 0) return;

        log(`🔄 Reconectando ${saved.length} tira(s) guardada(s)...`);
        isManualDisconnect = false;

        for (const device of saved) {
            if (!connectedLights.some(item => item.device.id === device.id)) {
                await connectSingleDevice(device, true);
                await sleep(250);
            }
        }
    } catch (e) {}
}

function waitForAdvertisement(device, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
        if (typeof device.watchAdvertisements !== 'function') {
            reject(new Error('No soportado'));
            return;
        }
        const abort = new AbortController();
        const timer = setTimeout(() => {
            abort.abort();
            reject(new Error('Timeout anuncio BLE'));
        }, timeoutMs);

        const onAdv = () => {
            clearTimeout(timer);
            device.removeEventListener('advertisementreceived', onAdv);
            abort.abort();
            resolve();
        };

        device.addEventListener('advertisementreceived', onAdv);
        device.watchAdvertisements({ signal: abort.signal }).catch(err => {
            clearTimeout(timer);
            device.removeEventListener('advertisementreceived', onAdv);
            reject(err);
        });
    });
}

async function connectGattWithRetry(device, maxRetries = 3, isAuto = false) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await device.gatt.connect();
        } catch (err) {
            if (isAuto && attempt === 1 && typeof device.watchAdvertisements === 'function') {
                try {
                    await waitForAdvertisement(device, 6000);
                    return await device.gatt.connect();
                } catch (e) {}
            }
            if (attempt === maxRetries) throw err;
            await sleep(isAndroid ? 600 : 400);
        }
    }
}

async function connectSingleDevice(device, isAuto = false) {
    try {
        if (connectedLights.some(item => item.device.id === device.id)) return;

        device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);
        device.addEventListener('gattserverdisconnected', handleDeviceDisconnected);

        if (!isAuto) log(`Enlazando con ${device.name || 'LED'}...`);

        let server = await connectGattWithRetry(device, isAuto ? 2 : 3, isAuto);
        await sleep(isAndroid ? 250 : 150);

        let services = [];
        try {
            services = await server.getPrimaryServices();
        } catch (err) {
            await sleep(350);
            server = await connectGattWithRetry(device, 2, isAuto);
            services = await server.getPrimaryServices();
        }

        let foundChar = null;
        let foundSvc = '';

        const preferred = ['ffe0', 'ffe5', 'fff0', 'ffd5', 'ffd0'];
        services.sort((a, b) => {
            const ia = preferred.indexOf(a.uuid.slice(4, 8));
            const ib = preferred.indexOf(b.uuid.slice(4, 8));
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });

        for (const service of services) {
            const shortSvc = service.uuid.slice(4, 8);
            if (['1800', '1801', '180a'].includes(shortSvc)) continue;

            try {
                const chars = await service.getCharacteristics();
                const exact = chars.find(c =>
                    ['ffe1', 'ffe9', 'fff3', 'ffd9'].includes(c.uuid.slice(4, 8)) &&
                    (c.properties.writeWithoutResponse || c.properties.write)
                );
                if (exact) {
                    foundChar = exact;
                    foundSvc = shortSvc;
                    break;
                }
                for (const c of chars) {
                    if (c.properties.writeWithoutResponse || c.properties.write) {
                        foundChar = c;
                        foundSvc = shortSvc;
                        break;
                    }
                }
            } catch (e) {}
            if (foundChar) break;
        }

        if (foundChar) {
            if (foundSvc === 'ffe0') protocolSelect.value = 'ledble';
            else if (foundSvc === 'fff0') protocolSelect.value = 'elk';
            else if (['ffe5', 'ffd5', 'ffd0'].includes(foundSvc)) protocolSelect.value = 'triones';

            const lightObj = { device, char: foundChar, queue: [], processing: false };
            connectedLights.push(lightObj);
            isLightsOn = true;

            log(`🎉 Conectada: ${device.name || 'LED'} [${foundSvc}→${foundChar.uuid.slice(4, 8)}]`);
            refreshDevicesUI();
            requestScreenWakeLock();

            // Handshake obligatorio en chips FFE0 (LEDBLE-00 / LED LAMP)
            if (protocolSelect.value === 'ledble') {
                await enqueueWrite(lightObj, new Uint8Array([0x2a, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), true);
            }

            await sendPowerCommand(true);
            await applyCurrentColor(true);
        } else if (!isAuto) {
            log(`❌ No se encontró canal de escritura en ${device.name || 'LED'}.`);
            if (device.gatt.connected) device.gatt.disconnect();
        }
    } catch (error) {
        if (!isAuto && error.name !== 'NotFoundError') {
            log(`❌ Error: ${error.message}`);
        }
    }
}

async function promptConnectDevice() {
    try {
        if (!navigator.bluetooth) {
            log('❌ Usa Google Chrome en HTTPS o localhost.');
            return;
        }
        isManualDisconnect = false;
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ALL_LED_SERVICES
        });
        await connectSingleDevice(device, false);
    } catch (e) {
        if (e.name !== 'NotFoundError') log(`❌ ${e.message}`);
    }
}

document.getElementById('btnAddDevice').addEventListener('click', promptConnectDevice);
document.getElementById('btnQuickConnect').addEventListener('click', promptConnectDevice);

document.getElementById('btnDisconnectAll').addEventListener('click', () => {
    isManualDisconnect = true;
    stopActiveMode();
    connectedLights.forEach(({ device }) => {
        if (device && device.gatt.connected) device.gatt.disconnect();
    });
    connectedLights = [];
    refreshDevicesUI();
    releaseScreenWakeLock();
    log('🔌 Todas las luces desconectadas.');
});

function handleDeviceDisconnected(event) {
    const dev = event.target;
    const prev = connectedLights.length;
    connectedLights = connectedLights.filter(item => item.device.id !== dev.id);

    if (connectedLights.length < prev) {
        refreshDevicesUI();
        log(`🔌 Desconectada: ${dev.name || 'LED'}`);

        if (!isManualDisconnect) {
            setTimeout(() => {
                if (!isManualDisconnect) connectSingleDevice(dev, true);
            }, 2000);
        }
    }
}

function refreshDevicesUI() {
    const count = connectedLights.length;
    connCountText.textContent = `${count} Conectada${count === 1 ? '' : 's'}`;
    connDot.className = count > 0 ? 'dot-status connected' : 'dot-status';
    btnMasterPower.disabled = count === 0;
    document.getElementById('btnDisconnectAll').disabled = count === 0;
    document.getElementById('btnQuickConnect').textContent = count > 0
        ? `🔗 Conectar Otra (${count})`
        : `🔗 Conectar Luz`;

    updatePowerButtonUI();

    if (count === 0) {
        deviceListDiv.innerHTML = `<p class="empty-msg">No hay tiras LED conectadas. Pulsa "+ Conectar Luz".</p>`;
        return;
    }

    deviceListDiv.innerHTML = connectedLights.map(({ device }, idx) => `
        <div class="device-item">
            <span>💡 <strong>${device.name || 'Tira LED #' + (idx + 1)}</strong></span>
            <span style="color:#34d399; font-size:0.78rem;">● En línea</span>
        </div>
    `).join('');
}

// ============================================================================
// ENCENDIDO / APAGADO PRINCIPAL
// ============================================================================
btnMasterPower.addEventListener('click', async () => {
    if (connectedLights.length === 0) return;
    isLightsOn = !isLightsOn;
    updatePowerButtonUI();
    await sendPowerCommand(isLightsOn);

    if (isLightsOn) {
        log('💡 Luces ENCENDIDAS.');
        await applyCurrentColor(true);
    } else {
        stopActiveMode();
        log('🌑 Luces APAGADAS.');
        ambientGlow.style.background = 'none';
    }
});

function updatePowerButtonUI() {
    if (isLightsOn && connectedLights.length > 0) {
        btnMasterPower.classList.add('is-on');
    } else {
        btnMasterPower.classList.remove('is-on');
    }
}

async function sendPowerCommand(turnOn) {
    if (connectedLights.length === 0) return;
    const proto = protocolSelect.value;

    if (proto === 'ledble') {
        const cmd1 = turnOn
            ? new Uint8Array([0x7e, 0xff, 0x04, 0x01, 0xff, 0xff, 0xff, 0xff, 0xef])
            : new Uint8Array([0x7e, 0xff, 0x04, 0x00, 0xff, 0xff, 0xff, 0xff, 0xef]);
        const cmd2 = turnOn
            ? new Uint8Array([0x7e, 0x00, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0xef])
            : new Uint8Array([0x7e, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0xef]);
        await sendToAllLights(cmd1, true);
        await sendToAllLights(cmd2, true);
    } else if (proto === 'elk') {
        const cmd = turnOn
            ? new Uint8Array([0x7e, 0x00, 0x04, 0xf0, 0x00, 0x01, 0xff, 0x00, 0xef])
            : new Uint8Array([0x7e, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0x00, 0xef]);
        await sendToAllLights(cmd, true);
    } else {
        const cmd = turnOn
            ? new Uint8Array([0xcc, 0x23, 0x33])
            : new Uint8Array([0xcc, 0x24, 0x33]);
        await sendToAllLights(cmd, true);
    }
}

// ============================================================================
// RUEDA DE COLOR RGB TÁCTIL + BRILLO + FAVORITOS DIY
// ============================================================================
const wheelCanvas = document.getElementById('colorWheel');
const wheelCtx = wheelCanvas.getContext('2d');
const wheelCursor = document.getElementById('wheelCursor');
const rgbReadout = document.getElementById('rgbReadout');
const brightnessSlider = document.getElementById('brightnessSlider');
const brightnessVal = document.getElementById('brightnessVal');

function drawColorWheel() {
    const size = wheelCanvas.width;
    const radius = size / 2;
    const img = wheelCtx.createImageData(size, size);
    const data = img.data;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - radius;
            const dy = y - radius;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const idx = (y * size + x) * 4;

            if (dist <= radius) {
                const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
                const sat = dist / radius;
                const { r, g, b } = hsvToRgb(angle, sat, 1);
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = 255;
            } else {
                data[idx + 3] = 0;
            }
        }
    }
    wheelCtx.putImageData(img, 0, 0);
}

function hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;

    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}

let isDraggingWheel = false;

function handleWheelPointer(e) {
    const rect = wheelCanvas.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = e.clientX - (rect.left + radius);
    let dy = e.clientY - (rect.top + radius);
    let dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > radius) {
        dx = (dx / dist) * radius;
        dy = (dy / dist) * radius;
        dist = radius;
    }

    wheelCursor.style.left = `${radius + dx}px`;
    wheelCursor.style.top = `${radius + dy}px`;

    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    const sat = dist / radius;
    currentRGB = hsvToRgb(angle, sat, 1);

    stopActiveMode();
    applyCurrentColor(false);
}

wheelCanvas.addEventListener('pointerdown', (e) => {
    isDraggingWheel = true;
    wheelCanvas.setPointerCapture(e.pointerId);
    handleWheelPointer(e);
});

wheelCanvas.addEventListener('pointermove', (e) => {
    if (isDraggingWheel) handleWheelPointer(e);
});

wheelCanvas.addEventListener('pointerup', () => {
    isDraggingWheel = false;
    applyCurrentColor(true);
});

brightnessSlider.addEventListener('input', () => {
    currentBrightness = parseInt(brightnessSlider.value, 10);
    brightnessVal.textContent = `${currentBrightness}%`;
    applyCurrentColor(false);
});

document.getElementById('btnPureWhite').addEventListener('click', () => {
    stopActiveMode();
    currentRGB = { r: 255, g: 255, b: 255 };
    wheelCursor.style.left = '50%';
    wheelCursor.style.top = '50%';
    applyCurrentColor(true);
});

document.querySelectorAll('#presetSwatches .swatch').forEach(btn => {
    btn.addEventListener('click', () => {
        stopActiveMode();
        const [r, g, b] = btn.dataset.rgb.split(',').map(Number);
        currentRGB = { r, g, b };
        applyCurrentColor(true);
    });
});

// Favoritos DIY guardados en localStorage
function renderDiySwatches() {
    const container = document.getElementById('diySwatches');
    const savedDiy = JSON.parse(localStorage.getItem('ledlamp_diy') || '[null,null,null,null,null,null]');

    container.innerHTML = savedDiy.map((rgb, idx) => {
        if (rgb) {
            return `<button class="swatch" data-diy="${idx}" style="background:rgb(${rgb.r},${rgb.g},${rgb.b});" title="Clic: aplicar | Mantén: sobrescribir"></button>`;
        }
        return `<button class="diy-slot" data-diy="${idx}" title="Guardar color actual">+</button>`;
    }).join('');

    container.querySelectorAll('button').forEach(btn => {
        const idx = parseInt(btn.dataset.diy, 10);
        btn.addEventListener('click', () => {
            const list = JSON.parse(localStorage.getItem('ledlamp_diy') || '[null,null,null,null,null,null]');
            if (!list[idx]) {
                list[idx] = { ...currentRGB };
                localStorage.setItem('ledlamp_diy', JSON.stringify(list));
                renderDiySwatches();
                log(`⭐ Color guardado en Favorito #${idx + 1}.`);
            } else {
                stopActiveMode();
                currentRGB = { ...list[idx] };
                applyCurrentColor(true);
            }
        });

        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const list = JSON.parse(localStorage.getItem('ledlamp_diy') || '[null,null,null,null,null,null]');
            list[idx] = { ...currentRGB };
            localStorage.setItem('ledlamp_diy', JSON.stringify(list));
            renderDiySwatches();
            log(`⭐ Favorito #${idx + 1} actualizado.`);
        });
    });
}

async function applyCurrentColor(force = false) {
    const { r, g, b } = currentRGB;
    rgbReadout.textContent = `RGB(${r}, ${g}, ${b})`;
    ambientGlow.style.background = `radial-gradient(circle at 50% 25%, rgba(${r}, ${g}, ${b}, 0.24), transparent 65%)`;

    const factor = currentBrightness / 100;
    const sr = Math.round(r * factor);
    const sg = Math.round(g * factor);
    const sb = Math.round(b * factor);

    await sendRawColor(sr, sg, sb, force);
}

async function sendRawColor(r, g, b, force = false) {
    if (connectedLights.length === 0 || !isLightsOn) return;

    const now = Date.now();
    const minGap = isAndroid ? 75 : 60;
    if (!force && now - lastSendTime < minGap) return;
    lastSendTime = now;

    const proto = protocolSelect.value;
    let cmd;

    if (proto === 'ledble') {
        cmd = new Uint8Array([0x7e, 0xff, 0x05, 0x03, r, g, b, 0xff, 0xef]);
    } else if (proto === 'elk') {
        cmd = new Uint8Array([0x7e, 0x00, 0x05, 0x03, r, g, b, 0x00, 0xef]);
    } else {
        cmd = new Uint8Array([0x56, r, g, b, 0x00, 0xf0, 0xaa]);
    }

    await sendToAllLights(cmd, force);
}

// ============================================================================
// PESTAÑA 2: MODOS DINÁMICOS Y VELOCIDAD
// ============================================================================
const speedSlider = document.getElementById('speedSlider');
const speedVal = document.getElementById('speedVal');
const btnStopMode = document.getElementById('btnStopMode');

speedSlider.addEventListener('input', () => {
    speedVal.textContent = `${speedSlider.value}%`;
    if (activeModeName) startDynamicMode(activeModeName);
});

document.querySelectorAll('.mode-item').forEach(btn => {
    btn.addEventListener('click', () => {
        startDynamicMode(btn.dataset.mode);
    });
});

btnStopMode.addEventListener('click', () => {
    stopActiveMode();
    applyCurrentColor(true);
});

function stopActiveMode() {
    if (activeModeInterval) {
        clearInterval(activeModeInterval);
        activeModeInterval = null;
    }
    activeModeName = null;
    btnStopMode.style.display = 'none';
    document.querySelectorAll('.mode-item').forEach(b => b.classList.remove('active'));
}

function startDynamicMode(mode) {
    stopActiveMode();
    stopCurrentAudio();

    activeModeName = mode;
    btnStopMode.style.display = 'block';
    document.querySelector(`.mode-item[data-mode="${mode}"]`)?.classList.add('active');

    const speedPct = parseInt(speedSlider.value, 10);
    const intervalMs = Math.max(85, Math.round(950 - (speedPct * 8.5)));
    let step = 0;

    const colors3 = [[255, 0, 0], [0, 255, 0], [0, 80, 255]];
    const colors7 = [[255, 0, 0], [255, 120, 0], [255, 240, 0], [0, 255, 0], [0, 220, 255], [0, 60, 255], [180, 0, 255]];

    activeModeInterval = setInterval(() => {
        if (!isLightsOn || connectedLights.length === 0) return;
        const factor = currentBrightness / 100;
        let r = 0, g = 0, b = 0;

        if (mode === 'jump3') {
            [r, g, b] = colors3[step % colors3.length];
        } else if (mode === 'jump7') {
            [r, g, b] = colors7[step % colors7.length];
        } else if (mode === 'fade7') {
            const hue = (step * 12) % 360;
            ({ r, g, b } = hsvToRgb(hue, 1, 1));
        } else if (mode === 'strobe') {
            const on = step % 2 === 0;
            r = g = b = on ? 255 : 0;
        } else if (mode === 'breath_cyan') {
            const wave = (Math.sin(step * 0.35) + 1) / 2;
            r = 0; g = Math.round(230 * wave); b = Math.round(255 * wave);
        } else if (mode === 'breath_purple') {
            const wave = (Math.sin(step * 0.35) + 1) / 2;
            r = Math.round(180 * wave); g = 0; b = Math.round(255 * wave);
        } else if (mode === 'fire') {
            r = 255; g = Math.floor(Math.random() * 90); b = 0;
        } else if (mode === 'ocean') {
            r = 0; g = 80 + Math.floor(Math.random() * 140); b = 255;
        }

        ambientGlow.style.background = `radial-gradient(circle at 50% 25%, rgba(${r}, ${g}, ${b}, 0.24), transparent 65%)`;
        sendRawColor(Math.round(r * factor), Math.round(g * factor), Math.round(b * factor), false);
        step++;
    }, intervalMs);
}

// ============================================================================
// PESTAÑA 3: MÚSICA (AUDIO DE PESTAÑA PC + MICRÓFONO ANDROID/PC)
// ============================================================================
const sensSlider = document.getElementById('sensitivity');
const sensVal = document.getElementById('sensVal');
const bassLevelSpan = document.getElementById('bassLevel');
const bassMeterFill = document.getElementById('bassMeterFill');
const audioStatusBadge = document.getElementById('audioStatusBadge');
const musicDisc = document.getElementById('musicDisc');

sensSlider.addEventListener('input', () => {
    sensVal.textContent = sensSlider.value;
});

document.getElementById('btnSystemAudio').addEventListener('click', async () => {
    if (!supportsDisplayAudio) return;
    try {
        stopActiveMode();
        stopCurrentAudio();
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach(t => t.stop());
            log('⚠️ Activa la casilla "Compartir audio de la pestaña".');
            return;
        }
        stream.getVideoTracks().forEach(t => t.stop());
        await startAudioProcessing(stream, 'AUDIO DE PESTAÑA EN VIVO');
        stream.getAudioTracks()[0].onended = () => stopCurrentAudio();
    } catch (e) {
        log(`❌ Audio cancelado: ${e.message}`);
    }
});

document.getElementById('btnMic').addEventListener('click', async () => {
    try {
        stopActiveMode();
        stopCurrentAudio();
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        await startAudioProcessing(stream, isAndroid ? 'MICRÓFONO ANDROID EN VIVO' : 'MICRÓFONO PC EN VIVO');
    } catch (e) {
        log(`❌ Error micrófono: ${e.message}`);
    }
});

document.getElementById('btnStopAudio').addEventListener('click', stopCurrentAudio);

async function startAudioProcessing(stream, label) {
    currentStream = stream;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') await audioContext.resume();

    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);

    dataArray = new Uint8Array(analyser.frequencyBinCount);
    isSyncing = true;

    audioStatusBadge.textContent = label;
    audioStatusBadge.className = 'badge badge-on';
    document.getElementById('btnStopAudio').style.display = 'block';
    requestScreenWakeLock();
    analyzeAudio();
}

function stopCurrentAudio() {
    isSyncing = false;
    if (currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
        currentStream = null;
    }
    if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
    }
    audioStatusBadge.textContent = 'MICRÓFONO / AUDIO INACTIVO';
