let bluetoothCharacteristics = []; // Lista para guardar todas las luces conectadas
let audioContext, analyser, dataArray;
let isSyncing = false;
let lastSendTime = 0;

const logDiv = document.getElementById('log');
const visualizer = document.getElementById('visualizer');
const sensSlider = document.getElementById('sensitivity');
const sensVal = document.getElementById('sensVal');
const speedSlider = document.getElementById('speedSlider');
const speedVal = document.getElementById('speedVal');
const bassLevelSpan = document.getElementById('bassLevel');
const protocolSelect = document.getElementById('protocolSelect');

sensSlider.addEventListener('input', () => sensVal.textContent = sensSlider.value);
speedSlider.addEventListener('input', () => speedVal.textContent = speedSlider.value);

function log(msg) {
    logDiv.innerHTML += `> ${msg}<br>`;
    logDiv.scrollTop = logDiv.scrollHeight;
}

// 1. CONEXIÓN DE MÚLTIPLES LUCECES BLUETOOTH
document.getElementById('btnBluetooth').addEventListener('click', async () => {
    try {
        log('Selecciona un dispositivo LED...');
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [
                0xfff0, 0xffe0, 0xffe5, 0xffd5,
                '0000fff0-0000-1000-8000-00805f9b34fb',
                '0000ffe5-0000-1000-8000-00805f9b34fb'
            ]
        });

        log(`Conectando a: ${device.name || 'LED'}...`);
        const server = await device.gatt.connect();
        const services = await server.getPrimaryServices();

        let found = false;
        for (const service of services) {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
                if (char.properties.write || char.properties.writeWithoutResponse) {
                    bluetoothCharacteristics.push(char);
                    log(`¡Luces añadidas! Total conectadas: ${bluetoothCharacteristics.length}`);
                    found = true;
                    break;
                }
            }
            if (found) break;
        }

        if (found) {
            // Envía una prueba en verde a todas las luces conectadas
            sendColorToAll(0, 255, 0, true);
        } else {
            log('ERROR: El dispositivo no tiene canal de escritura.');
        }
    } catch (error) {
        log(`Error BT: ${error.message}`);
    }
});

// BOTÓN DE PRUEBA (Envía color a TODAS las luces conectadas)
document.getElementById('btnTest').addEventListener('click', () => {
    const r = Math.floor(Math.random() * 255);
    const g = Math.floor(Math.random() * 255);
    const b = Math.floor(Math.random() * 255);
    log(`Prueba en grupo RGB(${r}, ${g}, ${b}) - Tiras: ${bluetoothCharacteristics.length}`);
    visualizer.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    sendColorToAll(r, g, b, true);
});

// FUNCIÓN PARA ENVIAR COMANDO A TODAS LAS LUCES AL MISMO TIEMPO
async function sendColorToAll(r, g, b, force = false) {
    if (bluetoothCharacteristics.length === 0) return;

    const now = Date.now();
    const throttleTime = 120 - parseInt(speedSlider.value, 10);
    if (!force && now - lastSendTime < throttleTime) return;
    lastSendTime = now;

    let command;
    if (protocolSelect.value === 'elk') {
        command = new Uint8Array([0x7e, 0x00, 0x05, 0x03, r, g, b, 0x00, 0xef]);
    } else {
        command = new Uint8Array([0x56, r, g, b, 0x00, 0xf0, 0xaa]);
    }

    // Enviamos la orden en paralelo a cada tira LED conectada
    for (const char of bluetoothCharacteristics) {
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

// 2. CAPTURA DE AUDIO DE YOUTUBE
document.getElementById('btnAudio').addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (stream.getAudioTracks().length === 0) {
            log('ERROR: Falta marcar "Compartir audio de la pestaña".');
            return;
        }

        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        dataArray = new Uint8Array(analyser.frequencyBinCount);
        isSyncing = true;
        log('¡Audio vinculado! Sincronizando todas las luces...');
        analyzeAudio();
    } catch (error) {
        log(`Error Audio: ${error.message}`);
    }
});

// 3. BUCLE RÍTMICO
const palette = [
    [255, 0, 80],   // Fucsia
    [0, 220, 255],  // Celeste
    [150, 0, 255],  // Morado
    [0, 255, 100],  // Verde
    [255, 140, 0]   // Naranja
];
let colorIndex = 0;

function analyzeAudio() {
    if (!isSyncing) return;
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