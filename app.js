const MOTION_THRESHOLD_LOW = 2.5; // m/s^2 deviation for deliberate medium shake (sad)
const MOTION_THRESHOLD_HIGH = 5.0; // m/s^2 deviation for strong shake (angry)
const COOLDOWN_TIME = 4000;   // ms before settling back to sleep

const ANGRY_MESSAGES = [
    "Don't touch me, Sam.",
    "Put me down right now, Sam.",
    "Focus on your work, Sam!",
    "Are you supposed to be holding me, Sam?",
    "Hands off, Sam!",
    "I was sleeping! Get back to work.",
    "Do you mind, Sam?",
    "This isn't focus time if you keep touching me.",
    "Leave me alone, Sam!",
    "I said no touching!"
];

const SAD_MESSAGES = [
    "Don't disturb me and work, Sam.",
    "Please let me sleep, Sam.",
    "Why the shaking, Sam?",
    "I'm trying to rest here...",
    "Sam, you're interrupting my nap.",
    "Just leave me on the desk, Sam.",
    "Careful! I'm resting.",
    "Can't a digital pet get some peace?"
];

const CRYING_MESSAGES = [
    "Please stop, Sam...",
    "Why are you doing this to me, Sam?",
    "*sniffles* Let me sleep, Sam!",
    "You're making this really hard, Sam.",
    "I'm so tired, please let me rest...",
    "Sam, this isn't funny anymore.",
    "Why won't you just focus?",
    "*crying* Just put me down!"
];

const UI = {
    startScreen: document.getElementById('start-screen'),
    focusScreen: document.getElementById('focus-screen'),
    durationSelect: document.getElementById('duration'),
    startBtn: document.getElementById('start-btn'),
    eyes: document.getElementById('eyes'),
    msgContainer: document.getElementById('message-container'),
    statsContainer: document.getElementById('stats-container'),
    loveFill: document.getElementById('love-fill'),
    datetimeDisplay: document.getElementById('datetime-display'),
    timerDisplay: document.getElementById('timer-display'),
    restartBtn: document.getElementById('restart-btn'),
    fullscreenToggle: document.getElementById('fullscreen-toggle'),
    dimOverlay: document.getElementById('dim-overlay')
};

const PetState = {
    SLEEPING: 'sleeping',
    WAKE: 'wake',
    ANGRY: 'angry',
    SAD: 'sad',
    CRYING: 'crying',
    FURIOUS: 'furious',
    BLINK: 'blink',
    HAPPY: 'happy',
    PAMPERING: 'happy', // Pamper mode uses happy eyes
    
    current: 'sleeping',
    isDisturbed: false,
    
    set(newState) {
        this.current = newState;
        UI.eyes.className = `eyes-container ${newState}`;
        
        // Software Dimming Logic
        if (newState === 'sleeping') {
            UI.dimOverlay.classList.remove('hidden');
        } else {
            UI.dimOverlay.classList.add('hidden');
        }
    }
};

let wakeLock = null;
let sessionEndTime = 0;
let timerInterval = null;
let baselineMotion = { x: 0, y: 0, z: 0 };
let isCalibrating = false;
let settleTimeout = null;
let praiseTimeout = null;

let disturbanceCount = 0;
let continuousFocusTime = 0;
let lastMessage = "";
let currentSessionMinutes = 0;
let loveLevel = parseInt(localStorage.getItem('focusPet_love') || '50', 10);

function updateLoveMeter(change = 0) {
    loveLevel += change;
    if (loveLevel > 100) loveLevel = 100;
    if (loveLevel < 0) loveLevel = 0;
    localStorage.setItem('focusPet_love', loveLevel.toString());
    UI.loveFill.style.width = `${loveLevel}%`;
}

function getDailyStats() {
    const today = new Date().toISOString().split('T')[0];
    const savedDate = localStorage.getItem('focusPet_daily_date');
    if (savedDate !== today) {
        localStorage.setItem('focusPet_daily_date', today);
        localStorage.setItem('focusPet_daily_minutes', '0');
        return 0;
    }
    return parseInt(localStorage.getItem('focusPet_daily_minutes') || '0', 10);
}

function updateDateTime() {
    const now = new Date();
    const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    UI.datetimeDisplay.textContent = now.toLocaleDateString('en-US', options);
}
setInterval(updateDateTime, 1000);
updateDateTime();

// Initialize events
updateLoveMeter(0); // Set initial UI
UI.startBtn.addEventListener('click', startSession);
UI.restartBtn.addEventListener('click', resetSession);

// Fullscreen toggle
UI.fullscreenToggle.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent triggering focus screen disturbance
    toggleFullscreen();
});

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.warn(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// Listen to touches anywhere on the focus screen
UI.focusScreen.addEventListener('touchstart', (e) => {
    if (!e.target.closest('#fullscreen-toggle') && e.target.id !== 'restart-btn') handleDisturbance('angry');
});
UI.focusScreen.addEventListener('click', (e) => {
    if (!e.target.closest('#fullscreen-toggle') && e.target.id !== 'restart-btn') handleDisturbance('angry');
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
    currentSessionMinutes = parseInt(UI.durationSelect.value, 10);
    sessionEndTime = Date.now() + currentSessionMinutes * 60 * 1000;
    
    // Switch UI
    UI.startScreen.classList.add('hidden');
    UI.focusScreen.classList.remove('hidden');
    UI.restartBtn.classList.add('hidden');
    UI.msgContainer.classList.add('hidden');
    UI.statsContainer.classList.add('hidden');
    UI.msgContainer.classList.remove('happy-msg');
    
    PetState.set(PetState.SLEEPING);
    PetState.isDisturbed = false;
    disturbanceCount = 0;
    continuousFocusTime = 0;
    
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
        
        if (PetState.current === PetState.SLEEPING) {
            continuousFocusTime++;
            if (continuousFocusTime > 0 && continuousFocusTime % 300 === 0) { // Every 5 minutes
                showPraise();
                updateLoveMeter(5);
            }
        }
    }
}

function showPraise() {
    PetState.set(PetState.HAPPY);
    UI.msgContainer.classList.add('happy-msg');
    showMessage("Good going Sam, please let me rest like this. You are a good boy.");
    
    clearTimeout(praiseTimeout);
    praiseTimeout = setTimeout(() => {
        // Only revert if we haven't been disturbed and session isn't over
        if (PetState.current === PetState.HAPPY && !PetState.isDisturbed && timerInterval !== null) {
            PetState.set(PetState.SLEEPING);
            hideMessage();
            UI.msgContainer.classList.remove('happy-msg');
        }
    }, 5000); // show praise for 5 seconds
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
    
    if (totalDeviation > MOTION_THRESHOLD_HIGH) {
        handleDisturbance('angry');
    } else if (totalDeviation > MOTION_THRESHOLD_LOW) {
        handleDisturbance('sad');
    }
}

function handleDisturbance(severity = 'angry') {
    if (timerInterval === null && PetState.current !== PetState.PAMPERING) return; // Session complete and not pampering, ignore
    
    if (PetState.current === PetState.PAMPERING) {
        // Pamper Mode Logic
        const pamperMsgs = ["Hehe, that tickles! 😘", "I love you Sam! 💋", "More pets please! ❤️", "Yay! 😘", "So comfy! ❤️"];
        let msg = pamperMsgs[Math.floor(Math.random() * pamperMsgs.length)];
        UI.msgContainer.classList.add('happy-msg');
        showMessage(msg);
        PetState.set(PetState.BLINK);
        setTimeout(() => PetState.set(PetState.PAMPERING), 150);
        return;
    }

    // Disturbance penalty
    updateLoveMeter(-2);
    
    // Disturbance resets good behavior streak
    continuousFocusTime = 0;
    clearTimeout(praiseTimeout);
    UI.msgContainer.classList.remove('happy-msg');
    
    if (!PetState.isDisturbed) {
        PetState.isDisturbed = true;
        disturbanceCount++;
        
        // Wake up quickly
        PetState.set(PetState.WAKE);
        
        // Then transition to angry or sad state shortly after
        setTimeout(() => {
            if (timerInterval !== null) { // Check if session is still active
                let msgList;
                if (disturbanceCount >= 10) {
                    severity = 'furious';
                    msgList = ["I hate you, Sam!"];
                } else if (disturbanceCount === 9) {
                    severity = 'angry';
                    msgList = ["This is your last warning, Sam."];
                } else if (disturbanceCount === 3) {
                    msgList = CRYING_MESSAGES;
                    severity = 'crying'; // Force sad crying eyes on the 3rd shake
                } else if (disturbanceCount > 3) {
                    msgList = ANGRY_MESSAGES;
                    severity = 'angry'; // Force angry eyes on the 4th shake and beyond
                } else {
                    msgList = severity === 'sad' ? SAD_MESSAGES : ANGRY_MESSAGES;
                }
                
                let msg;
                do {
                    msg = msgList[Math.floor(Math.random() * msgList.length)];
                } while (msg === lastMessage && msgList.length > 1);
                lastMessage = msg;

                if (severity === 'furious') {
                    PetState.set(PetState.FURIOUS);
                    UI.msgContainer.classList.remove('sad-msg');
                    UI.msgContainer.classList.add('furious-msg');
                    showMessage(msg);
                    failSession();
                    return; // Halt further actions
                } else if (severity === 'sad') {
                    PetState.set(PetState.SAD);
                    UI.msgContainer.classList.add('sad-msg');
                    showMessage(msg);
                } else if (severity === 'crying') {
                    PetState.set(PetState.CRYING);
                    UI.msgContainer.classList.add('sad-msg');
                    showMessage(msg);
                } else {
                    PetState.set(PetState.ANGRY);
                    UI.msgContainer.classList.remove('sad-msg');
                    showMessage(msg);
                }
            }
        }, 300);
    } else {
        // Escalate to angry if already sad but shaken harder, unless they are crying
        if (severity === 'angry' && PetState.current === PetState.SAD && disturbanceCount < 3) {
            PetState.set(PetState.ANGRY);
            UI.msgContainer.classList.remove('sad-msg');
            let msg;
            do {
                msg = ANGRY_MESSAGES[Math.floor(Math.random() * ANGRY_MESSAGES.length)];
            } while (msg === lastMessage && ANGRY_MESSAGES.length > 1);
            lastMessage = msg;
            showMessage(msg);
        }
    }
    
    // Reset the settle cooldown on continuous disturbance (skip if furious)
    if (PetState.current !== PetState.FURIOUS) {
        clearTimeout(settleTimeout);
        settleTimeout = setTimeout(() => {
            if (timerInterval !== null) {
                PetState.set(PetState.BLINK);
                hideMessage();
                UI.msgContainer.classList.remove('furious-msg');
                
                setTimeout(() => {
                    if (timerInterval !== null) {
                        PetState.set(PetState.SLEEPING);
                        PetState.isDisturbed = false;
                    }
                }, 150); // Short blink duration
            }
        }, COOLDOWN_TIME);
    }
}

function showMessage(msg) {
    UI.msgContainer.textContent = msg;
    UI.msgContainer.classList.remove('hidden');
}

function hideMessage() {
    UI.msgContainer.classList.add('hidden');
}

function failSession() {
    clearInterval(timerInterval);
    timerInterval = null; // Mark session as inactive
    window.removeEventListener('devicemotion', monitorMotion);
    clearTimeout(settleTimeout);
    clearTimeout(praiseTimeout);
    
    if (wakeLock !== null) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }

    setTimeout(() => {
        UI.msgContainer.classList.remove('furious-msg');
        showMessage("I am disappointed with you, Sam.");
        UI.timerDisplay.textContent = "";
        UI.restartBtn.classList.remove('hidden');
    }, 2000); // 2 seconds of furious before fail state
}

function completeSession() {
    clearInterval(timerInterval);
    timerInterval = null; // Mark session as inactive
    window.removeEventListener('devicemotion', monitorMotion);
    clearTimeout(settleTimeout);
    clearTimeout(praiseTimeout);
    
    UI.dimOverlay.classList.add('hidden'); // Ensure dimmer is off

    if (wakeLock !== null) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
    
    // Calculate and save stats
    let totalSessions = parseInt(localStorage.getItem('focusPet_sessions') || '0', 10);
    let totalMinutes = parseInt(localStorage.getItem('focusPet_minutes') || '0', 10);
    let dailyMinutes = getDailyStats();

    totalSessions += 1;
    totalMinutes += currentSessionMinutes;
    dailyMinutes += currentSessionMinutes;

    localStorage.setItem('focusPet_sessions', totalSessions.toString());
    localStorage.setItem('focusPet_minutes', totalMinutes.toString());
    localStorage.setItem('focusPet_daily_minutes', dailyMinutes.toString());

    // Display Stats
    UI.statsContainer.innerHTML = `Daily Focus: <span>${dailyMinutes} mins</span> <br> Total Focus: <span>${totalMinutes} mins</span>`;
    UI.statsContainer.classList.remove('hidden');

    UI.msgContainer.classList.add('happy-msg');
    
    // Pamper Mode Calculation
    let pamperMinutes = 0;
    if (currentSessionMinutes === 1 || currentSessionMinutes === 20) {
        pamperMinutes = 1;
    } else if (currentSessionMinutes >= 30) {
        pamperMinutes = 2;
    }

    if (pamperMinutes > 0) {
        PetState.set(PetState.PAMPERING);
        PetState.isDisturbed = false;
        showMessage(`You did it! 😘 💋 ❤️ <br><br> <span style="font-size:1rem;color:#ccc;">(Pamper Mode: ${pamperMinutes} min - shake to pet me!)</span>`);
        
        setTimeout(() => {
            if (PetState.current === PetState.PAMPERING || PetState.current === PetState.BLINK) {
                PetState.set(PetState.HAPPY);
                showMessage("You did it! 😘 💋 ❤️");
                UI.restartBtn.classList.remove('hidden');
            }
        }, pamperMinutes * 60 * 1000);
    } else {
        PetState.set(PetState.HAPPY);
        PetState.isDisturbed = false;
        showMessage("You did it! 😘 💋 ❤️");
        UI.restartBtn.classList.remove('hidden');
    }
    
    UI.timerDisplay.textContent = "";
}

function resetSession() {
    PetState.current = PetState.WAKE; // Escape pamper mode if active
    UI.focusScreen.classList.add('hidden');
    UI.statsContainer.classList.add('hidden');
    UI.startScreen.classList.remove('hidden');
}
