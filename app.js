// ============================================================================
// DETECCIÓN DE PLATAFORMA Y SEGURIDAD (PC vs ANDROID)
// ============================================================================
const isAndroid = /Android/i.test(navigator.userAgent);
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const supportsDisplayAudio = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !isMobile;

let connectedLights = []; // { device, char, protocol, queue, processing }
let audioContext = null;
let analyser = null;
let dataArray = null;
let currentStream = null;
let wakeLock = null;
let isSyncing = false;
let isLightsOn = true;
let lastSendTime = 0;
let player = null;

// Referencias DOM
const logDiv = document.getElementById('log');
const visualizer = document.getElementById('visualizer');
const ambientGlow = document.getElementById('ambientGlow');
const sensSlider = document.getElementById('sensitivity');
const sensVal = document.getElementById('sensVal');
const bassLevelSpan = document.getElementById('bassLevel');
const bassMeterFill = document.getElementById('bassMeterFill');
const statusBadge = document.getElementById('statusBadge');
const protocolSelect = document.getElementById('protocolSelect');
const platformBadge = document.getElementById('platformBadge');
const securityWarning = document.getElementById('securityWarning');
const audioHelperText = document.getElementById('audioHelperText');

const btnBluetooth = document.getElementById('btnBluetooth');
const btnDisconnect = document.getElementById('btnDisconnect');
const btnPower = document.getElementById('btnPower');
const btnSystemAudio = document.getElementById('btnSystemAudio');
const btnMic = document.getElementById('btnMic');
const btnStopAudio = document.getElementById('btnStopAudio');
const btnTest = document.getElementById('btnTest');
const btnClearLog = document.getElementById('btnClearLog');

// Todos los UUIDs estándar de controladores LED BLE
const ALL_LED_SERVICES = [
    '0000ffe0-0000-1000-8000-00805f9b34fb', // LEDBLE-00 / LED LAMP
    '0000ffe5-0000-1000-8000-00805f9b34fb', // Triones / LEDBLE clásico
    '0000fff0-0000-1000-8000-00805f9b34fb', // ELK-BLEDOM / MELK
    '0000ffd0-0000-1000-8000-00805f9b34fb', // Triones
    '0000ffd5-0000-1000-8000-00805f9b34fb', // Triones / Zengge
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ff12-0000-1000-8000-00805f9b34fb',
    '0000ae00-0000-1000-8000-00805f9b34fb',
    '0000ae30-0000-1000-8000-00805f9b34fb',
    '0000af00-0000-1000-8000-00805f9b34fb',
    '00001000-0000-1000-8000-00805f9b34fb',
    '00001800-0000-1000-8000-00805f9b34fb',
    '00001801-0000-1000-8000-00805f9b34fb',
    '0000180a-0000-1000-8000-00805f9b34fb',
    '0000fee0-0000-1000-8000-00805f9b34fb',
    '0000fee9-0000-1000-8000-00805f9b34fb'
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Inicialización según el Sistema Operativo
(function initEnvironment() {
    if (!window.isSecureContext) {
        securityWarning.style.display = 'block';
    }

    if (isAndroid) {
        platformBadge.textContent = 'MODO ANDROID';
        btnSystemAudio.style.display = 'none';
        btnMic.className = 'btn btn-accent';
        btnMic.innerHTML = '<span>🎙️</span> Activar Micrófono (Android)';
        audioHelperText.textContent = 'En Android, usa el micrófono (optimizado sin filtro de ruido) y activa Ubicación (GPS) para escanear Bluetooth.';
        log('📱 Entorno Android detectado. Asegúrate de tener Ubicación (GPS) y Bluetooth activos.');
    } else if (isMobile) {
        platformBadge.textContent = 'MODO MÓVIL';
        btnSystemAudio.style.display = 'none';
    } else {
        platformBadge.textContent = 'MODO ESCRITORIO (PC)';
        log('💻 Entorno PC detectado. Audio de pestaña y micrófono disponibles.');
    }
})();

sensSlider.addEventListener('input', () => {
    sensVal.textContent = sensSlider.value;
});

btnClearLog.addEventListener('click', () => {
    logDiv.innerHTML = '';
});

function log(msg) {
    logDiv.innerHTML += `> ${msg}<br>`;
    logDiv.scrollTop = logDiv.scrollHeight;
}

function updateUIButtons() {
    const count = connectedLights.length;
    btnDisconnect.disabled = count === 0;
    btnTest.disabled = count === 0;
    btnPower.disabled = count === 0;
    btnBluetooth.innerHTML = count > 0
        ? `<span>🔗</span> Conectar Otra (${count})`
        : `<span>🔗</span> Conectar Luz`;

    updatePowerButtonUI();
}

function updatePowerButtonUI() {
    if (connectedLights.length === 0) {
        btnPower.innerHTML = `<span>⏻</span> Encender / Apagar`;
        btnPower.className = 'btn btn-secondary';
        return;
    }

    if (isLightsOn) {
        btnPower.innerHTML = `<span>⏻</span> Encender / Apagar (ON)`;
        btnPower.className = 'btn btn-secondary';
    } else {
        btnPower.innerHTML = `<span>⏻</span> Encender / Apagar (OFF)`;
        btnPower.className = 'btn btn-danger';
    }
}

// ============================================================================
// WAKE LOCK (EVITA QUE ANDROID APAGUE LA PANTALLA Y CORTE EL BLUETOOTH)
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
// COLA DE ESCRITURA GATT SERIALIZADA (EVITA GATT ERROR 133 EN ANDROID Y WINDOWS)
// ============================================================================
function enqueueWrite(light, bytes, isPriority = false) {
    if (!light || !light.device.gatt.connected) return Promise.resolve();

    // Si es un paquete de ritmo y ya hay paquetes pendientes, descartamos el viejo para evitar retrasos
    if (!isPriority && light.queue.length > 1) {
        return Promise.resolve();
    }

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
                if (light.device.gatt.connected) {
                    await light.char.writeValue(bytes);
                }
            } catch (e) {}
        }
        // Pausa mínima de estabilidad para Android y chips FFE0
        await sleep(isAndroid ? 45 : 35);
        resolve();
    }

    light.processing = false;
}

async function sendToAllLights(bytes, isPriority = false) {
    const tasks = connectedLights.map(light => enqueueWrite(light, bytes, isPriority));
    await Promise.all(tasks);
}

// ============================================================================
// CONEXIÓN BLUETOOTH MULTI-PLATAFORMA (WINDOWS + ANDROID)
// ============================================================================
async function connectGattWithRetry(device, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                log(`Reintentando enlace (${attempt}/${maxRetries})...`);
            }
            return await device.gatt.connect();
        } catch (err) {
            if (attempt === maxRetries) throw err;
            await sleep(isAndroid ? 600 : 400);
        }
    }
}

btnBluetooth.addEventListener('click', async () => {
    try {
        if (!navigator.bluetooth) {
            log('❌ Web Bluetooth no disponible. Usa Chrome y abre el sitio en HTTPS o localhost.');
            return;
        }

        log('Buscando dispositivos Bluetooth...');
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ALL_LED_SERVICES
        });

        if (connectedLights.some(item => item.device.id === device.id)) {
            log(`⚠️ ${device.name || 'Esta luz'} ya está conectada.`);
            return;
        }

        device.addEventListener('gattserverdisconnected', handleDeviceDisconnected);
        log(`Enlazando con ${device.name || 'LED'}...`);

        let server = await connectGattWithRetry(device, 3);
        await sleep(isAndroid ? 250 : 150); // Estabilización GATT en Android/Windows

        let services = [];
        try {
            services = await server.getPrimaryServices();
        } catch (err) {
            log('Reestabilizando servicios GATT...');
            await sleep(350);
            server = await connectGattWithRetry(device, 2);
            services = await server.getPrimaryServices();
        }

        let foundChar = null;
        let foundServiceUuid = '';
        let detectedList = [];

        // Prioridad de servicios según controladores comerciales
        const preferredOrder = ['ffe0', 'ffe5', 'fff0', 'ffd5', 'ffd0'];
        services.sort((a, b) => {
            const sa = a.uuid.slice(4, 8);
            const sb = b.uuid.slice(4, 8);
            const ia = preferredOrder.indexOf(sa);
            const ib = preferredOrder.indexOf(sb);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });

        for (const service of services) {
            const shortSvc = service.uuid.slice(4, 8);
            detectedList.push(shortSvc);

            if (shortSvc === '1800' || shortSvc === '1801' || shortSvc === '180a') continue;

            try {
                const characteristics = await service.getCharacteristics();
                const exactChar = characteristics.find(c => {
                    const sc = c.uuid.slice(4, 8);
                    return ['ffe1', 'ffe9', 'fff3', 'ffd9'].includes(sc) &&
                           (c.properties.writeWithoutResponse || c.properties.write);
                });

                if (exactChar) {
                    foundChar = exactChar;
                    foundServiceUuid = shortSvc;
                    break;
                }

                for (const char of characteristics) {
                    if (char.properties.writeWithoutResponse || char.properties.write) {
                        foundChar = char;
                        foundServiceUuid = shortSvc;
                        break;
                    }
                }
            } catch (e) {}
            if (foundChar) break;
        }

        if (foundChar) {
            // Auto-selección precisa según el canal físico detectado en el chip
            if (foundServiceUuid === 'ffe0') {
                protocolSelect.value = 'ledble';
            } else if (foundServiceUuid === 'fff0') {
                protocolSelect.value = 'elk';
            } else if (foundServiceUuid === 'ffe5' || foundServiceUuid === 'ffd5' || foundServiceUuid === 'ffd0') {
                protocolSelect.value = 'triones';
            }

            const lightObj = {
                device,
                char: foundChar,
                queue: [],
                processing: false
            };

            connectedLights.push(lightObj);
            isLightsOn = true;

            log(`✅ Canal [${foundServiceUuid} -> ${foundChar.uuid.slice(4, 8)}] | Protocolo: ${protocolSelect.value.toUpperCase()}`);
            log(`🎉 ¡Luz #${connectedLights.length} (${device.name || 'LED'}) conectada!`);
            updateUIButtons();
            requestScreenWakeLock();

            // Handshake inicial para chips FFE0 (LEDBLE-00)
            if (protocolSelect.value === 'ledble') {
                await enqueueWrite(lightObj, new Uint8Array([0x2a, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), true);
            }

            await sendPowerCommand(true);
            await sendColorToAll(0, 255, 100, true);
            updateVisualGlow(0, 255, 100);
        } else {
            log(`❌ Sin canal de escritura. Servicios: [${detectedList.join(', ')}]`);
            if (device.gatt.connected) device.gatt.disconnect();
        }
    } catch (error) {
        if (error.name !== 'NotFoundError') {
            log(`❌ Error: ${error.message}`);
            if (isAndroid) {
                log('💡 Tip Android: Activa Ubicación (GPS) y asegúrate de que no esté conectada a otra app.');
            } else {
                log('💡 Tip Windows: Si aparece "Emparejado" en Configuración de Windows, quítalo primero.');
            }
        }
    }
});

// ============================================================================
// ENCENDER / APAGAR Y CONTROL DE COLOR
// ============================================================================
btnPower.addEventListener('click', async () => {
    if (connectedLights.length === 0) return;

    isLightsOn = !isLightsOn;
    updatePowerButtonUI();
    await sendPowerCommand(isLightsOn);

    if (isLightsOn) {
        log('💡 Luces ENCENDIDAS.');
        updateVisualGlow(0, 255, 100);
        await sendColorToAll(0, 255, 100, true);
    } else {
        log('🌑 Luces APAGADAS.');
        resetVisualGlow();
    }
});

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

btnTest.addEventListener('click', async () => {
    if (!isLightsOn) {
        isLightsOn = true;
        updatePowerButtonUI();
        await sendPowerCommand(true);
    }

    const r = Math.floor(Math.random() * 255);
    const g = Math.floor(Math.random() * 255);
    const b = Math.floor(Math.random() * 255);
    log(`Prueba RGB(${r}, ${g}, ${b})`);
    updateVisualGlow(r, g, b);
    await sendColorToAll(r, g, b, true);
});

async function sendColorToAll(r, g, b, force = false) {
    if (connectedLights.length === 0 || !isLightsOn) return;

    const now = Date.now();
    const minInterval = isAndroid ? 80 : 65;
    if (!force && now - lastSendTime < minInterval) return;
    lastSendTime = now;

    const proto = protocolSelect.value;
    let command;

    if (proto === 'ledble') {
        command = new Uint8Array([0x7e, 0xff, 0x05, 0x03, r, g, b, 0xff, 0xef]);
    } else if (proto === 'elk') {
        command = new Uint8Array([0x7e, 0x00, 0x05, 0x03, r, g, b, 0x00, 0xef]);
    } else {
        command = new Uint8Array([0x56, r, g, b, 0x00, 0xf0, 0xaa]);
    }

    await sendToAllLights(command, force);
}

// Desconexión manual y automática
btnDisconnect.addEventListener('click', () => {
    if (connectedLights.length === 0) return;

    log('Desconectando luces...');
    const list = [...connectedLights];
    list.forEach(({ device }) => {
        if (device && device.gatt.connected) {
            device.gatt.disconnect();
        }
    });

    connectedLights = [];
    isLightsOn = true;
    resetVisualGlow();
    releaseScreenWakeLock();
    updateUIButtons();
});

function handleDeviceDisconnected(event) {
    const dev = event.target;
    const prev = connectedLights.length;
    connectedLights = connectedLights.filter(item => item.device.id !== dev.id);

    if (connectedLights.length < prev) {
        log(`🔌 Desconectada: ${dev.name || 'Luz LED'}`);
        if (connectedLights.length === 0) {
            isLightsOn = true;
            resetVisualGlow();
            releaseScreenWakeLock();
        }
        updateUIButtons();
    }
}

// ============================================================================
// CAPTURA DE AUDIO (PC TAB AUDIO + MICRÓFONO OPTIMIZADO PARA ANDROID)
// ============================================================================
btnSystemAudio.addEventListener('click', async () => {
    if (!supportsDisplayAudio) {
        log('⚠️ La captura de pestaña solo está disponible en PC. Usa el micrófono.');
        return;
    }

    try {
        stopCurrentAudio();
        log('Elige la pestaña con música y activa "Compartir audio de la pestaña"...');

        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            stream.getTracks().forEach(t => t.stop());
            log('⚠️ No activaste la casilla "Compartir audio". Inténtalo de nuevo.');
            return;
        }

        stream.getVideoTracks().forEach(t => t.stop());
        await startAudioProcessing(stream, 'Audio de Pestaña (PC)');

        audioTracks[0].onended = () => {
            stopCurrentAudio();
            log('⏹️ Captura de pestaña finalizada.');
        };
    } catch (e) {
        log(`❌ Captura cancelada: ${e.message}`);
    }
});

btnMic.addEventListener('click', async () => {
    try {
        stopCurrentAudio();
        log('Solicitando permiso de micrófono...');

        // Desactivar filtros de voz es vital en Android para captar los bajos de la música
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        await startAudioProcessing(stream, isAndroid ? 'Micrófono Android' : 'Micrófono PC');
    } catch (e) {
        log(`❌ Error micrófono: ${e.message}`);
    }
});

btnStopAudio.addEventListener('click', () => {
    stopCurrentAudio();
    log('⏹️ Sincronización de audio detenida.');
});

async function startAudioProcessing(stream, label) {
    currentStream = stream;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();

    // En Android, AudioContext inicia suspendido hasta que se reanuda en un evento de usuario
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.55;

    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    isSyncing = true;

    statusBadge.textContent = 'EN VIVO';
    statusBadge.className = 'badge badge-on';
    btnStopAudio.style.display = 'flex';
    requestScreenWakeLock();

    log(`🎶 ${label} activo. ¡Reproduce tu música!`);
    analyzeAudio();
}

function stopCurrentAudio() {
    isSyncing = false;
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
    if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
    }
    statusBadge.textContent = 'INACTIVO';
    statusBadge.className = 'badge badge-off';
    btnStopAudio.style.display = 'none';
    bassMeterFill.style.width = '0%';
    bassLevelSpan.textContent = '0';
}

// ============================================================================
// REPRODUCTOR YOUTUBE OPCIONAL
// ============================================================================
function onYouTubeIframeAPIReady() {}

document.getElementById('loadVideo').addEventListener('click', () => {
    const urlInput = document.getElementById('ytUrl').value;
    const videoId = extractVideoId(urlInput);

    if (!videoId) {
        log('Link de YouTube inválido.');
        return;
    }

    document.getElementById('player-container').style.display = 'block';

    if (!player) {
        player = new YT.Player('youtube-player', {
            height: '180',
            width: '100%',
            videoId: videoId,
            playerVars: { 'playsinline': 1 },
            events: {
                'onReady': (event) => event.target.playVideo()
            }
        });
    } else {
        player.loadVideoById(videoId);
    }

    log(isAndroid
        ? 'Video cargado. Pulsa "Activar Micrófono (Android)" para sincronizar con el altavoz.'
        : 'Video cargado. Pulsa "Audio de Pestaña (PC)" y elige esta pestaña.');
});

function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// ============================================================================
// MOTOR VISUAL Y DETECCIÓN DE GRAVES
// ============================================================================
const palette = [
    [255, 0, 85],    // Neón Rosa
    [0, 210, 255],   // Cian Eléctrico
    [140, 0, 255],   // Violeta
    [0, 255, 110],   // Verde Esmeralda
    [255, 130, 0],   // Naranja Intenso
    [255, 230, 0],   // Amarillo
    [255, 20, 20]    // Rojo Puro
];
let colorIndex = 0;

function updateVisualGlow(r, g, b) {
    visualizer.style.boxShadow = `0 0 35px rgba(${r}, ${g}, ${b}, 0.85)`;
    ambientGlow.style.background = `radial-gradient(circle, rgba(${r}, ${g}, ${b}, 0.22) 0%, rgba(9, 9, 11, 0) 70%)`;
}

function resetVisualGlow() {
    visualizer.style.boxShadow = '0 0 25px rgba(0, 0, 0, 0.6)';
    ambientGlow.style.background = 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, rgba(9, 9, 11, 0) 70%)';
}

function analyzeAudio() {
    if (!isSyncing || !analyser) return;
    requestAnimationFrame(analyzeAudio);

    analyser.getByteFrequencyData(dataArray);

    let bassSum = 0;
    for (let i = 0; i < 8; i++) bassSum += dataArray[i];
    const bassAvg = Math.round(bassSum / 8);

    bassLevelSpan.textContent = bassAvg;
    bassMeterFill.style.width = `${Math.min(100, (bassAvg / 255) * 100)}%`;

    const threshold = parseInt(sensSlider.value, 10);
    const scale = 1 + (bassAvg / 255) * 0.22;
    visualizer.style.transform = `scale(${scale}) rotate(${Date.now() / 12 % 360}deg)`;

    if (bassAvg >= threshold && isLightsOn) {
        colorIndex = (colorIndex + 1) % palette.length;
        const [r, g, b] = palette[colorIndex];
        updateVisualGlow(r, g, b);
        sendColorToAll(r, g, b);
    }
}
