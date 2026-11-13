let connectedLights = []; // Guarda objetos { device, char } de las luces conectadas
let audioContext, analyser, dataArray, sourceConnected = false;
let isSyncing = false;
let lastSendTime = 0;
let player;

const logDiv = document.getElementById('log');
const visualizer = document.getElementById('visualizer');
const sensSlider = document.getElementById('sensitivity');
const sensVal = document.getElementById('sensVal');
const bassLevelSpan = document.getElementById('bassLevel');
const protocolSelect = document.getElementById('protocolSelect');

const btnBluetooth = document.getElementById('btnBluetooth');
const btnDisconnect = document.getElementById('btnDisconnect');
const btnTest = document.getElementById('btnTest');

sensSlider.addEventListener('input', () => sensVal.textContent = sensSlider.value);

function log(msg) {
    logDiv.innerHTML += `> ${msg}<br>`;
    logDiv.scrollTop = logDiv.scrollHeight;
}

// Actualiza el estado visual de los botones según cuántas luces haya conectadas
function updateUIButtons() {
    const count = connectedLights.length;
    btnDisconnect.disabled = count === 0;
    btnTest.disabled = count === 0;
    btnBluetooth.textContent = count > 0 ? `🔗 Conectar Otra (${count})` : '🔗 Conectar Luz';
}

// 1. CONEXIÓN MULTI-BLUETOOTH
btnBluetooth.addEventListener('click', async () => {
    try {
        log('Buscando dispositivo LED...');
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [0xfff0, 0xffe0, 0xffe5, '0000fff0-0000-1000-8000-00805f9b34fb']
        });

        // Evitar conectar dos veces el mismo dispositivo
        if (connectedLights.some(item => item.device.id === device.id)) {
            log(`⚠️ ${device.name || 'Esta luz'} ya está conectada.`);
            return;
        }

        // Escuchar si la luz se apaga o pierde señal
        device.addEventListener('gattserverdisconnected', handleDeviceDisconnected);

        log(`Conectando a: ${device.name || 'LED'}...`);
        const server = await device.gatt.connect();
        const services = await server.getPrimaryServices();

        let foundChar = null;
        for (const service of services) {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
                if (char.properties.write || char.properties.writeWithoutResponse) {
                    foundChar = char;
                    break;
                }
            }
            if (foundChar) break;
        }

        if (foundChar) {
            connectedLights.push({ device, char: foundChar });
            log(`¡Luz #${connectedLights.length} (${device.name || 'LED'}) conectada!`);
            updateUIButtons();
            sendColorToAll(0, 255, 0, true); // Prueba en verde al conectar
        } else {
            log('Error: Sin canal de escritura.');
            device.gatt.disconnect();
        }
    } catch (error) {
        log(`Error BT: ${error.message}`);
    }
});

// BOTÓN DE DESCONEXIÓN MANUAL (Desconecta todas las luces)
btnDisconnect.addEventListener('click', () => {
    if (connectedLights.length === 0) return;

    log('Desconectando luces...');
    // Hacemos una copia del arreglo antes de recorrerlo porque el evento 'gattserverdisconnected' lo irá vaciando
    const lightsToDisconnect = [...connectedLights];
    
    lightsToDisconnect.forEach(({ device }) => {
        if (device && device.gatt.connected) {
            device.gatt.disconnect();
        }
    });

    connectedLights = [];
    visualizer.style.backgroundColor = 'transparent';
    updateUIButtons();
});

// MANEJADOR DE DESCONEXIÓN (Manual o pérdida de señal)
function handleDeviceDisconnected(event) {
    const disconnectedDevice = event.target;
    const prevLength = connectedLights.length;
    
    connectedLights = connectedLights.filter(item => item.device.id !== disconnectedDevice.id);
    
    if (connectedLights.length < prevLength) {
        log(`🔌 Desconectada: ${disconnectedDevice.name || 'Luz LED'}`);
        updateUIButtons();
    }
}

// BOTÓN DE PRUEBA PARA AMBAS LUCES
btnTest.addEventListener('click', () => {
    const r = Math.floor(Math.random() * 255);
    const g = Math.floor(Math.random() * 255);
    const b = Math.floor(Math.random() * 255);
    log(`Prueba en grupo RGB(${r}, ${g}, ${b})`);
    visualizer.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    sendColorToAll(r, g, b, true);
});

async function sendColorToAll(r, g, b, force = false) {
    if (connectedLights.length === 0) return;

    const now = Date.now();
    if (!force && now - lastSendTime < 60) return;
    lastSendTime = now;

    let command;
    if (protocolSelect.value === 'elk') {
        command = new Uint8Array([0x7e, 0x00, 0x05, 0x03, r, g, b, 0x00, 0xef]);
    } else {
        command = new Uint8Array([0x56, r, g, b, 0x00, 0xf0, 0xaa]);
    }

    for (const { char } of connectedLights) {
        try {
            if (char.properties.writeWithoutResponse) {
                await char.writeValueWithoutResponse(command);
            } else {
                await char.writeValue(command);
            }
        } catch (e) {
            try { await char.writeValue(command); } catch (err) {}
        }
    }
}

// 2. CONFIGURACIÓN DEL REPRODUCTOR YOUTUBE INTERNO
function onYouTubeIframeAPIReady() {
    // Se inicializa solo
}

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
            height: '160',
            width: '100%',
            videoId: videoId,
            playerVars: { 'playsinline': 1 },
            events: {
                'onReady': (event) => {
                    event.target.playVideo();
                    setupAudioAnalyzer();
                },
                'onStateChange': (event) => {
                    if (event.data == YT.PlayerState.PLAYING && !isSyncing) {
                        isSyncing = true;
                        analyzeAudio();
                    }
                }
            }
        });
    } else {
        player.loadVideoById(videoId);
    }
    log('Cargando música de YouTube...');
});

function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// 3. CAPTURA DE AUDIO DESDE EL REPRODUCTOR INTERNO
function setupAudioAnalyzer() {
    if (sourceConnected) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const iframeVideo = document.querySelector('#youtube-player');
        
        const source = audioContext.createMediaElementSource(iframeVideo);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        sourceConnected = true;
        log('¡Audio de YouTube conectado al sistema!');
    } catch (e) {
        log('Nota: Reproduce el video para activar el audio.');
    }
}

// 4. BUCLE DE RITMO PARA LAS DOS LUCES
const palette = [
    [255, 0, 80],   // Fucsia
    [0, 220, 255],  // Celeste
    [150, 0, 255],  // Morado
    [0, 255, 100],  // Verde
    [255, 140, 0]   // Naranja
];
let colorIndex = 0;

function analyzeAudio() {
    if (!isSyncing || !analyser) return;
    requestAnimationFrame(analyzeAudio);

    analyser.getByteFrequencyData(dataArray);

    let bassSum = 0;
    for (let i = 0; i < 8; i++) bassSum += dataArray[i];
    const bassAvg = Math.round(bassSum / 8);
    bassLevelSpan.textContent = bassAvg;

    const threshold = parseInt(sensSlider.value, 10);
    const scale = 1 + (bassAvg / 255) * 0.4;
    visualizer.style.transform = `scale(${scale}) rotate(${Date.now() / 10 % 360}deg)`;

    if (bassAvg >= threshold) {
        colorIndex = (colorIndex + 1) % palette.length;
        const [r, g, b] = palette[colorIndex];
        visualizer.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        sendColorToAll(r, g, b);
    }
}
