const MOTION_THRESHOLD = 2.0; // m/s^2 deviation to trigger a disturbance
const COOLDOWN_TIME = 4000;   // ms before settling back to sleep

const MESSAGES = [
    "Don't touch me.",
    "Put me down.",
    "I'm trying to sleep.",
    "Focus, please."
];

const UI = {
    startScreen: document.getElementById('start-screen'),
    focusScreen: document.getElementById('focus-screen'),
    durationSelect: document.getElementById('duration'),
    startBtn: document.getElementById('start-btn'),
    eyes: document.getElementById('eyes'),
    msgContainer: document.getElementById('message-container'),
    timerDisplay: document.getElementById('timer-display'),
    restartBtn: document.getElementById('restart-btn')
};

const PetState = {
    SLEEPING: 'sleeping',
    WAKE: 'wake',
    ANGRY: 'angry',
    BLINK: 'blink',
    HAPPY: 'happy',
    
    current: 'sleeping',
    isDisturbed: false, // Prevents multiple rapid disturbance triggers overlapping
    
    set(newState) {
        this.current = newState;
        UI.eyes.className = `eyes-container ${newState}`;
    }
};

let wakeLock = null;
let sessionEndTime = 0;
let timerInterval = null;
let baselineMotion = { x: 0, y: 0, z: 0 };
let isCalibrating = false;
let settleTimeout = null;

// Initialize events
UI.startBtn.addEventListener('click', startSession);
UI.restartBtn.addEventListener('click', resetSession);

// Listen to touches anywhere on the focus screen
UI.focusScreen.addEventListener('touchstart', (e) => {
    if (e.target.id !== 'restart-btn') handleDisturbance();
});
UI.focusScreen.addEventListener('click', (e) => {
    if (e.target.id !== 'restart-btn') handleDisturbance();
});

// Re-acquire wake lock if tab is hidden and shown again (Chrome behaviour)
document.addEventListener('visibilitychange', () => {
    if (wakeLock !== null && document.visibilityState === 'visible' && PetState.current !== PetState.HAPPY) {
        requestWakeLock();
    }
});

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
            console.warn(`Wake Lock error: ${err.name}, ${err.message}`);
        }
    }
}

async function startSession() {
    const minutes = parseInt(UI.durationSelect.value, 10);
    sessionEndTime = Date.now() + minutes * 60 * 1000;
    
    // Switch UI
    UI.startScreen.classList.add('hidden');
    UI.focusScreen.classList.remove('hidden');
    UI.restartBtn.classList.add('hidden');
    UI.msgContainer.classList.add('hidden');
    UI.msgContainer.classList.remove('happy-msg');
    
    PetState.set(PetState.SLEEPING);
    PetState.isDisturbed = false;
    
    await requestWakeLock();
    
    // Start timer
    updateTimerDisplay();
    timerInterval = setInterval(tick, 1000);
    
    // Start calibration for motion detection
    startCalibration();
}

function tick() {
    const remaining = sessionEndTime - Date.now();
    if (remaining <= 0) {
        completeSession();
    } else {
        updateTimerDisplay(remaining);
    }
}

function updateTimerDisplay(msRemaining) {
    if (msRemaining === undefined) msRemaining = sessionEndTime - Date.now();
    const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    UI.timerDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function startCalibration() {
    isCalibrating = true;
    baselineMotion = { x: 0, y: 0, z: 0 };
    let samples = 0;
    
    const calHandler = (e) => {
        const acc = e.accelerationIncludingGravity || e.acceleration;
        if (acc && acc.x !== null) {
            baselineMotion.x += acc.x;
            baselineMotion.y += acc.y;
            baselineMotion.z += acc.z;
            samples++;
        }
    };
    
    window.addEventListener('devicemotion', calHandler);
    
    setTimeout(() => {
        window.removeEventListener('devicemotion', calHandler);
        if (samples > 0) {
            baselineMotion.x /= samples;
            baselineMotion.y /= samples;
            baselineMotion.z /= samples;
        }
        isCalibrating = false;
        
        window.addEventListener('devicemotion', monitorMotion);
    }, 2500); // 2.5 seconds to establish baseline
}

function monitorMotion(e) {
    if (isCalibrating || PetState.current === PetState.HAPPY) return;
    
    const acc = e.accelerationIncludingGravity || e.acceleration;
    if (!acc || acc.x === null) return;
    
    const dx = acc.x - baselineMotion.x;
    const dy = acc.y - baselineMotion.y;
    const dz = acc.z - baselineMotion.z;
    
    const totalDeviation = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    if (totalDeviation > MOTION_THRESHOLD) {
        handleDisturbance();
    }
}

function handleDisturbance() {
    if (PetState.current === PetState.HAPPY) return;
    
    if (!PetState.isDisturbed) {
        PetState.isDisturbed = true;
        
        // Wake up quickly
        PetState.set(PetState.WAKE);
        
        // Then transition to angry state shortly after
        setTimeout(() => {
            if (PetState.current !== PetState.HAPPY) {
                PetState.set(PetState.ANGRY);
                showMessage(MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);
            }
        }, 300);
    }
    
    // Reset the settle cooldown on continuous disturbance
    clearTimeout(settleTimeout);
    settleTimeout = setTimeout(() => {
        if (PetState.current !== PetState.HAPPY) {
            PetState.set(PetState.BLINK);
            hideMessage();
            
            setTimeout(() => {
                if (PetState.current !== PetState.HAPPY) {
                    PetState.set(PetState.SLEEPING);
                    PetState.isDisturbed = false;
                }
            }, 150); // Short blink duration
        }
    }, COOLDOWN_TIME);
}

function showMessage(msg) {
    UI.msgContainer.textContent = msg;
    UI.msgContainer.classList.remove('hidden');
}

function hideMessage() {
    UI.msgContainer.classList.add('hidden');
}

function completeSession() {
    clearInterval(timerInterval);
    window.removeEventListener('devicemotion', monitorMotion);
    clearTimeout(settleTimeout);
    
    if (wakeLock !== null) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
    
    PetState.set(PetState.HAPPY);
    PetState.isDisturbed = false;
    
    UI.msgContainer.classList.add('happy-msg');
    showMessage("You did it!");
    
    UI.timerDisplay.textContent = "";
    UI.restartBtn.classList.remove('hidden');
}

function resetSession() {
    UI.focusScreen.classList.add('hidden');
    UI.startScreen.classList.remove('hidden');
}
