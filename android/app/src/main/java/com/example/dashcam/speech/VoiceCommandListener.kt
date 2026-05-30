package com.example.dashcam.speech

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

/**
 * Continuous voice commands listener implementation.
 * Actively loops SpeechRecognizer instances on the UI thread to capture log triggers.
 * Incorporates aggressive self-healing recovery triggers in standard listeners (onError/onResults).
 */
class VoiceCommandListener(
    private val context: Context,
    private val onCommandTriggered: (String) -> Unit
) : RecognitionListener {

    sealed class ListenerState {
        object Idle : ListenerState()
        object Listening : ListenerState()
        data class Error(val code: Int, val message: String) : ListenerState()
    }

    private val _state = MutableStateFlow<ListenerState>(ListenerState.Idle)
    val state: StateFlow<ListenerState> = _state

    private var speechRecognizer: SpeechRecognizer? = null
    private var isContinuousListeningEnabled = false

    private val recognizerIntent: Intent by lazy {
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            // Request on-device offline recognition if available (Highly recommended for dashcams)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }
    }

    /**
     * Spawns the Speech Service resources and begins active polling.
     */
    fun startListening() {
        if (speechRecognizer != null) return
        isContinuousListeningEnabled = true
        Log.i("VoiceCommandListener", "Speech services starting listener loop...")

        try {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(this@VoiceCommandListener)
                startListening(recognizerIntent)
            }
            _state.value = ListenerState.Listening
            Log.i("VoiceCommandListener", "SpeechRecognizer initialized and startListening invoked successfully.")
        } catch (e: Exception) {
            Log.e("VoiceCommandListener", "Failed to initialize SpeechRecognizer engine: ${e.localizedMessage}", e)
            _state.value = ListenerState.Error(-1, "Speech startup failed: ${e.localizedMessage}")
        }
    }

    /**
     * Completely frees speech assets and shuts down the continuous audio loop.
     */
    fun stopListening() {
        isContinuousListeningEnabled = false
        Log.i("VoiceCommandListener", "Stopping continuous speech listening...")
        speechRecognizer?.apply {
            stopListening()
            cancel()
            destroy()
        }
        speechRecognizer = null
        _state.value = ListenerState.Idle
    }

    /**
     * Restarts the session cleanly without building new instances.
     */
    private fun restartListening() {
        if (!isContinuousListeningEnabled) return
        Log.d("VoiceCommandListener", "Rebounding SpeechRecognizer active polling...")
        speechRecognizer?.apply {
            cancel()
            startListening(recognizerIntent)
        }
        _state.value = ListenerState.Listening
    }

    // --- RecognitionListener Callbacks ---

    override fun onReadyForSpeech(params: Bundle?) {
        _state.value = ListenerState.Listening
        Log.d("VoiceCommandListener", "Microphone hot. Ready for driver voice commands: 'Log Good Driver', 'Log Bad Driver'")
    }

    override fun onBeginningOfSpeech() {
        Log.v("VoiceCommandListener", "Speech beginning matching detect pattern.")
    }

    override fun onRmsChanged(rmsdB: Float) {}

    override fun onBufferReceived(buffer: ByteArray?) {}

    override fun onEndOfSpeech() {}

    override fun onError(error: Int) {
        val errorMessage = when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
            SpeechRecognizer.ERROR_CLIENT -> "Client-side error"
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Permissions missing"
            SpeechRecognizer.ERROR_NETWORK -> "Network issue"
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
            SpeechRecognizer.ERROR_NO_MATCH -> "No command detected"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
            SpeechRecognizer.ERROR_SERVER -> "Server error"
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Driving silence"
            else -> "Unknown Speech Error"
        }

        Log.w("VoiceCommandListener", "SpeechRecognizer onError callback triggered. Code: $error -> Message: $errorMessage")
        _state.value = ListenerState.Error(error, errorMessage)

        // Self-Healing Core: Automatically restart when silent timeouts or non-fatal matching errors crop up.
        if (isContinuousListeningEnabled && (
                error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT || 
                error == SpeechRecognizer.ERROR_NO_MATCH || 
                error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ||
                error == SpeechRecognizer.ERROR_CLIENT
            )) {
            Log.d("VoiceCommandListener", "Self-Healing trigger: attempting audio restart on non-fatal code ($error).")
            restartListening()
        }
    }

    override fun onResults(results: Bundle?) {
        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        Log.i("VoiceCommandListener", "Received final match alternatives count: ${matches?.size ?: 0}")
        matches?.forEach { text ->
            val cleanText = text.lowercase(Locale.ROOT).trim()
            Log.v("VoiceCommandListener", "Evaluating speech token: '$cleanText'")
            
            // Fuzzy match the exact key trigger instructions requested by driver
            if (cleanText.contains("log good driver") || cleanText.contains("log code driver")) {
                Log.i("VoiceCommandListener", "MATCH ACCEPTED: 'Good Driver' trigger event detected matches candidate text.")
                onCommandTriggered("GOOD")
                return@forEach
            } else if (cleanText.contains("log bad driver") || cleanText.contains("log map driver")) {
                Log.i("VoiceCommandListener", "MATCH ACCEPTED: 'Bad Driver' trigger event detected matches candidate text.")
                onCommandTriggered("BAD")
                return@forEach
            }
        }

        // Keep the speech cycle executing continuously after results are evaluated
        if (isContinuousListeningEnabled) {
            restartListening()
        }
    }

    override fun onPartialResults(partialResults: Bundle?) {
        // Option to intercept partial speech streams immediately if low-latency logs are required.
        val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        matches?.forEach { text ->
            val cleanText = text.lowercase(Locale.ROOT)
            if (cleanText.contains("log good driver")) {
                Log.i("VoiceCommandListener", "Partial Match: 'Good Driver' found.")
                onCommandTriggered("GOOD")
                restartListening()
                return
            } else if (cleanText.contains("log bad driver")) {
                Log.i("VoiceCommandListener", "Partial Match: 'Bad Driver' found.")
                onCommandTriggered("BAD")
                restartListening()
                return
            }
        }
    }

    override fun onEvent(eventType: Int, params: Bundle?) {}
}

    override fun onEvent(eventType: Int, params: Bundle?) {}
}
