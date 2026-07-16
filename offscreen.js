// The service worker has no DOM and cannot play audio, so it delegates to this
// offscreen document. The chime is synthesized instead of shipped as a file.

// Work ends on a calm descending pair, a break ends on a rising, wake-up pair.
const CHIMES = {
    work: [880, 660],
    shortBreak: [660, 880],
    longBreak: [660, 880],
};

const NOTE_SECONDS = 0.18;
const GAP_SECONDS = 0.06;
const PEAK_GAIN = 0.15;

const playChime = async (phase) => {
    const context = new AudioContext();
    if (context.state === 'suspended') await context.resume();

    const notes = CHIMES[phase] || CHIMES.work;
    let at = context.currentTime;

    for (const frequency of notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;

        // a short fade in and out - a bare square-edged note clicks
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.02);
        gain.gain.linearRampToValueAtTime(0, at + NOTE_SECONDS);

        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + NOTE_SECONDS);

        at += NOTE_SECONDS + GAP_SECONDS;
    }

    const totalMs = (at - context.currentTime) * 1000;
    await new Promise((resolve) => setTimeout(resolve, totalMs + 100));
    await context.close();
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.target !== 'offscreen' || message.action !== 'play-sound') return false;

    // Free the document once the chime is done; the worker recreates it on demand.
    playChime(message.phase)
        .catch(() => {})
        .finally(() => {
            sendResponse({ played: true });
            window.close();
        });

    return true;   // keep the message channel open for the async response
});