/*
 * glue.c — minimal eSpeak NG → WebAssembly glue for the espeak-ng-wasm driver.
 *
 * Whole-utterance model: espeak_Synth() in AUDIO_OUTPUT_SYNCHRONOUS mode
 * blocks until the utterance is fully synthesized; the synth callback
 * accumulates PCM into a static buffer; the JS side reads the buffer out
 * after the call returns. (Synchronous mode matches --without-async and is
 * what the upstream emscripten port used; AUDIO_OUTPUT_RETRIEVAL would add
 * an async event loop we do not need.)
 *
 * PCM format: 22050 Hz, 16-bit signed little-endian, mono (INTERFACE.md §3).
 */

#include <string.h>
#include <espeak-ng/speak_lib.h>

/* 60 s ceiling at 22050 Hz — far above any single-call utterance
 * (INTERFACE.md §3 limits input to 500 IPA characters). */
#define PCM_CAP (22050 * 60)

static short pcm_buf[PCM_CAP];
static int   pcm_len      = 0;
static int   pcm_overflow = 0;
static int   sample_rate  = 0;

static int synth_cb(short *samples, int count, espeak_EVENT *events) {
    (void)events;
    if (samples == NULL || count <= 0) return 0; /* end-of-utterance marker */
    if (pcm_len + count > PCM_CAP) {
        pcm_overflow = 1;
        return 1; /* abort synthesis */
    }
    memcpy(pcm_buf + pcm_len, samples, (size_t)count * sizeof(short));
    pcm_len += count;
    return 0;
}

/* data_path: directory CONTAINING espeak-ng-data ("/" when the .data pack
 * is preloaded at /espeak-ng-data). Returns the engine sample rate in Hz,
 * or -1 on failure. */
int espeakng_init(const char *data_path) {
    sample_rate = espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, data_path,
                                    espeakINITIALIZE_DONT_EXIT);
    if (sample_rate <= 0) return -1;
    espeak_SetSynthCallback(synth_cb);
    return sample_rate;
}

/* 0 (EE_OK) on success. The engine requires a voice even in phoneme
 * ([[...]]) mode; the driver passes "la". */
int espeakng_set_voice(const char *name) {
    return (int)espeak_SetVoiceByName(name);
}

/* Synthesize text — normally a [[...]] phoneme-mnemonic string mapped from
 * IPA by the driver. Returns sample count >= 0, -1 on PCM buffer overflow,
 * -2 on engine error.
 *
 * espeakPHONEMES is REQUIRED: without it the engine treats "[[...]]" as
 * literal text (brackets dropped as punctuation, letters sent to the
 * dictionary path — which the trimmed data package deliberately lacks,
 * yielding silence). The native CLI enables it in its default synth_flags;
 * the library does not. */
int espeakng_synthesize(const char *text) {
    espeak_ERROR err;
    pcm_len = 0;
    pcm_overflow = 0;
    err = espeak_Synth(text, 0, 0, POS_CHARACTER, 0,
                       espeakCHARS_UTF8 | espeakPHONEMES, NULL, NULL);
    if (err != EE_OK) return -2;
    espeak_Synchronize();
    if (pcm_overflow) return -1;
    return pcm_len;
}

/* Offset into wasm memory; JS reads HEAP16 at (ptr >> 1). */
short *espeakng_pcm(void) { return pcm_buf; }

int espeakng_pcm_len(void)     { return pcm_len; }
int espeakng_sample_rate(void) { return sample_rate; }

/* 0 (EE_OK) on success. rate: words per minute, 80–450 (default 175).
 * pitch: 0–99 (default 50). See INTERFACE.md §3. */
int espeakng_set_rate(int wpm)  { return (int)espeak_SetParameter(espeakRATE,  wpm, 0); }
int espeakng_set_pitch(int val) { return (int)espeak_SetParameter(espeakPITCH, val, 0); }

void espeakng_terminate(void) { espeak_Terminate(); }
