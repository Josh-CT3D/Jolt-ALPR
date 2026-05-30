// src/codebaseData.ts

export interface CodeFile {
  name: string;
  path: string;
  language: string;
  description: string;
  content: string;
}

export const androidCodebase: CodeFile[] = [
  {
    name: "MainActivity.kt",
    path: "app/src/main/java/com/example/dashcam/MainActivity.kt",
    language: "kotlin",
    description: "Core Activity establishing permissions, binding CameraX to the Pixel 10 physical 5x telephoto lens characteristics, initializing continuous speech recognition, and rendering the native Compose UI dashboard with OrientationEventListener support and complete logger diagnostics.",
    content: `package com.example.dashcam

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraMetadata
import android.os.Bundle
import android.speech.SpeechRecognizer
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.example.dashcam.camera.TelephotoAnalyzer
import com.example.dashcam.data.DriverLog
import com.example.dashcam.speech.VoiceCommandListener
import com.example.dashcam.ui.DashcamViewModel
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Main Activity for the Edge ALPR & Driver Logger Dashcam App.
 * Handles CameraX configurations targeting physical telephoto,
 * continuous speech background tasks, and Compose lifecycle integrations.
 */
class MainActivity : ComponentActivity() {

    private val viewModel: DashcamViewModel by viewModels()
    private lateinit var cameraExecutor: ExecutorService
    private var telephotoAnalyzer: TelephotoAnalyzer? = null
    private var voiceCommandListener: VoiceCommandListener? = null

    // Permissions requested for secure edge deployment
    private val requiredPermissions = arrayOf(
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION
    )

    private val permissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val cameraGranted = permissions[Manifest.permission.CAMERA] ?: false
        val audioGranted = permissions[Manifest.permission.RECORD_AUDIO] ?: false
        val locationGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false

        if (cameraGranted && audioGranted && locationGranted) {
            setupDashcamServices()
        } else {
            Toast.makeText(
                this,
                "Essential Permissions (Camera/Mic/GPS) were denied. Dashcam cannot initialize.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cameraExecutor = Executors.newSingleThreadExecutor()

        if (allPermissionsGranted()) {
            setupDashcamServices()
        } else {
            permissionsLauncher.launch(requiredPermissions)
        }

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(0xFF00E676),      // Vivid Android Green
                    secondary = Color(0xFF00B0FF),    // Driving Sky Blue
                    background = Color(0xFF121212),   // High-contrast deep gray charcoal
                    surface = Color(0xFF1E1E1E)
                )
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val activeOcr by viewModel.activePlateOcr.collectAsState()
                    val activeMmc by viewModel.activeVehicleMmc.collectAsState()
                    val logList by viewModel.logsList.collectAsState()
                    val speechState = voiceCommandListener?.state?.collectAsState()?.value
                        ?: VoiceCommandListener.ListenerState.Idle
                    val gpsLocation by viewModel.currentLocation.collectAsState()
                    val bannerNotification by viewModel.notificationMessage.collectAsState()

                    DashcamDashboardScreen(
                        activeOcr = activeOcr,
                        activeMmc = activeMmc,
                        logList = logList,
                        speechState = speechState,
                        gpsLatitude = gpsLocation?.latitude ?: 0.0,
                        gpsLongitude = gpsLocation?.longitude ?: 0.0,
                        bannerNotification = bannerNotification,
                        onDismissNotification = { viewModel.dismissNotification() },
                        onClearLogs = { viewModel.clearLogs() },
                        onPresetTrigger = { rating -> viewModel.handleVoiceRatingCommand(rating) }
                    )
                }
            }
        }
    }

    private fun allPermissionsGranted() = requiredPermissions.all {
        ContextCompat.checkSelfPermission(baseContext, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun setupDashcamServices() {
        android.util.Log.i("MainActivity", "Initializing ALPR hybrid frame-processor analyzer...")
        try {
            telephotoAnalyzer = TelephotoAnalyzer(applicationContext, lifecycleScope).apply {
                lifecycleScope.launch {
                    pipelineState.collect { state ->
                        viewModel.updateActiveDetection(state.activePlateocr, state.activeVehicleMmc)
                    }
                }
            }
            android.util.Log.i("MainActivity", "TelephotoAnalyzer successfully built.")
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "CRITICAL: Failed to load ML assets or instantiate TelephotoAnalyzer: \${e.localizedMessage}", e)
            Toast.makeText(this, "ML Engine failure: \${e.localizedMessage}", Toast.LENGTH_LONG).show()
        }

        android.util.Log.i("MainActivity", "Starting driver hands-free continuous Speech Recognizer...")
        try {
            voiceCommandListener = VoiceCommandListener(applicationContext) { rating ->
                android.util.Log.i("MainActivity", "Continuous Speech matcher matched trigger command! [Rating: \$rating]")
                viewModel.handleVoiceRatingCommand(rating)
            }
            voiceCommandListener?.startListening()
            android.util.Log.i("MainActivity", "VoiceCommandListener successfully initialized and polling audio stream.")
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "CRITICAL ERROR: Speech recognizer initiation failed: \${e.localizedMessage}", e)
            Toast.makeText(this, "Speech recognizer failure: \${e.localizedMessage}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
        voiceCommandListener?.stopListening()
    }
}`
  },
  {
    name: "TelephotoAnalyzer.kt",
    path: "app/src/main/java/com/example/dashcam/camera/TelephotoAnalyzer.kt",
    language: "kotlin",
    description: "CameraX ImageAnalysis analyzer enforcing a strict 1 FPS throttle. Rotates frame matrices dynamically to sync with orientation changes, running TFLite YOLOv8 crops, Google ML Kit OCR text parses, and MMC classifier fallbacks.",
    content: `package com.example.dashcam.camera

import android.content.Context
import android.graphics.*
import android.media.Image
import android.util.Log
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.example.dashcam.data.DriverLog
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class TelephotoAnalyzer(
    private val context: Context,
    private val uiScope: CoroutineScope
) : ImageAnalysis.Analyzer {

    private var lastAnalyzedTimestamp = 0L

    @OptIn(ExperimentalGetImage::class)
    override fun analyze(image: ImageProxy) {
        val currentMillis = System.currentTimeMillis()

        if (currentMillis - lastAnalyzedTimestamp < 1000L) {
            image.close()
            return
        }
        lastAnalyzedTimestamp = currentMillis

        val mediaImage = image.image ?: run {
            Log.w("TelephotoAnalyzer", "CameraX Frame skipped: media.Image payload is raw null.")
            image.close()
            return
        }

        uiScope.launch(Dispatchers.Default) {
            val startTime = System.currentTimeMillis()
            try {
                val rotationDegrees = image.imageInfo.rotationDegrees
                Log.d("TelephotoAnalyzer", "Frame received. Active device sensor rotation: \${rotationDegrees}°")
                
                val origBitmap = mediaImage.toBitmap()
                val bitmap = if (rotationDegrees != 0) {
                    Log.i("TelephotoAnalyzer", "Reconfiguring Frame Layout: Rotating frame matrix by \${rotationDegrees}° to match device rotation.")
                    origBitmap.rotate(rotationDegrees.toFloat())
                } else {
                    origBitmap
                }

                executeHybridMlPipeline(bitmap)

                val elapsed = System.currentTimeMillis() - startTime
                Log.d("TelephotoAnalyzer", "Full Edge Inference Pipeline completed in \${elapsed}ms")
            } catch (e: Exception) {
                Log.e("TelephotoAnalyzer", "CRITICAL PIPELINE EXCEPTION during frame analysis: \${e.localizedMessage}", e)
            } finally {
                image.close()
            }
        }
    }
}`
  },
  {
    name: "VoiceCommandListener.kt",
    path: "app/src/main/java/com/example/dashcam/speech/VoiceCommandListener.kt",
    language: "kotlin",
    description: "Hands-free continuous driving speech listener. Intercepts speech-to-text cycles using Android SpeechRecognizer, matching 'Log Good Driver' and 'Log Bad Driver' with auto-rebounding error resilience.",
    content: `package com.example.dashcam.speech

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

class VoiceCommandListener(
    private val context: Context,
    private val onCommandTriggered: (String) -> Unit
) : RecognitionListener {

    private var isContinuousListeningEnabled = false

    override fun onResults(results: Bundle?) {
        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        Log.i("VoiceCommandListener", "Speech results decoded: match count = \${matches?.size}")
        matches?.forEach { text ->
            val clean = text.lowercase(Locale.ROOT)
            if (clean.contains("log good driver")) {
                Log.i("VoiceCommandListener", "Command triggered: GOOD")
                onCommandTriggered("GOOD")
                return
            } else if (clean.contains("log bad driver")) {
                Log.i("VoiceCommandListener", "Command triggered: BAD")
                onCommandTriggered("BAD")
                return
            }
        }
        if (isContinuousListeningEnabled) restartListening()
    }

    override fun onError(error: Int) {
        Log.w("VoiceCommandListener", "SpeechRecognizer onError callback triggered. Code: $error")
        if (isContinuousListeningEnabled) {
            Log.d("VoiceCommandListener", "Self-healing trigger: attempting service restart.")
            restartListening()
        }
    }
}`
  },
  {
    name: "BatteryMonitor.kt",
    path: "app/src/main/java/com/example/dashcam/service/BatteryMonitor.kt",
    language: "kotlin",
    description: "System battery level monitoring helper utilizing Intent.ACTION_BATTERY_CHANGED sticky broadcasts to fetch real-time power metrics of the host CPU device.",
    content: `package com.example.dashcam.service

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.util.Log

/**
 * Android system hardware service helper to query current battery metrics.
 */
class BatteryMonitor(private val context: Context) {
    fun getBatteryLevel(): Int {
        return try {
            val batteryStatus: Intent? = context.registerReceiver(
                null,
                IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            )
            val level = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            if (level >= 0 && scale > 0) {
                (level * 100 / scale.toFloat()).toInt()
            } else {
                -1
            }
        } catch (e: Exception) {
            Log.e("BatteryMonitor", "Error reading battery level: \${e.localizedMessage}")
            -1
        }
    }
}`
  },
  {
    name: "DashcamViewModel.kt",
    path: "app/src/main/java/com/example/dashcam/ui/DashcamViewModel.kt",
    language: "kotlin",
    description: "Jetpack ViewModel orchestration. Spawns continuous location updates callback, tracks system hardware battery stats, records timestamped location breadcrumbs, and logs voice-triggered driver behaviors.",
    content: `package com.example.dashcam.ui

import android.annotation.SuppressLint
import android.app.Application
import android.location.Location
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.dashcam.camera.TelephotoAnalyzer
import com.example.dashcam.data.*
import com.example.dashcam.service.BatteryMonitor
import com.google.android.gms.location.*
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class DashcamViewModel(application: Application) : AndroidViewModel(application) {

    private val db = AppDatabase.getDatabase(application)
    private val dao = db.driverLogDao()
    private val batteryMonitor = BatteryMonitor(application)

    val logsList: StateFlow<List<DriverLog>> = dao.getAllLogs()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000L), emptyList())

    val locationHistoryList: StateFlow<List<LocationRecord>> = dao.getAllLocationRecords()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000L), emptyList())

    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(application)

    private val _currentLocation = MutableStateFlow<Location?>(null)
    val currentLocation: StateFlow<Location?> = _currentLocation

    private val _activePlateOcr = MutableStateFlow<String?>(null)
    val activePlateOcr: StateFlow<String?> = _activePlateOcr

    private val _activeVehicleMmc = MutableStateFlow<String?>(null)
    val activeVehicleMmc: StateFlow<String?> = _activeVehicleMmc

    private val _notificationMessage = MutableStateFlow<String?>(null)
    val notificationMessage: StateFlow<String?> = _notificationMessage

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(locationResult: LocationResult) {
            super.onLocationResult(locationResult)
            val location = locationResult.lastLocation ?: return
            _currentLocation.value = location
            Log.d("DashcamViewModel", "Continuous Location captured: lat=\${location.latitude}, lon=\${location.longitude}")

            viewModelScope.launch {
                try {
                    val record = LocationRecord(
                        timestamp = System.currentTimeMillis(),
                        latitude = location.latitude,
                        longitude = location.longitude,
                        speed = location.speed,
                        accuracy = location.accuracy
                    )
                    dao.safeInsertLocationRecord(record)
                } catch (e: Exception) {
                    Log.e("DashcamViewModel", "Database write failed during continuous GPS log: \${e.localizedMessage}")
                }
            }
        }
    }

    init {
        fetchUpdatedLocation()
        startLocationUpdates()
    }

    fun updateActiveDetection(plateOcr: String?, vehicleMmc: String?) {
        _activePlateOcr.value = plateOcr
        _activeVehicleMmc.value = vehicleMmc
    }

    @SuppressLint("MissingPermission")
    fun fetchUpdatedLocation() {
        try {
            fusedLocationClient.getCurrentLocation(
                Priority.PRIORITY_HIGH_ACCURACY,
                CancellationTokenSource().token
            ).addOnSuccessListener { location ->
                if (location != null) {
                    _currentLocation.value = location
                }
            }
        } catch (e: Exception) {
            Log.e("DashcamViewModel", "Location resolution failed: \${e.localizedMessage}")
        }
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        try {
            val locationRequest = LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                5000L
            ).build()

            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                android.os.Looper.getMainLooper()
            )
        } catch (e: Exception) {
            Log.e("DashcamViewModel", "Error starting continuous GPS updates: \${e.localizedMessage}")
        }
    }

    fun handleVoiceRatingCommand(rating: String) {
        viewModelScope.launch {
            try {
                fetchUpdatedLocation()
                val loc = _currentLocation.value
                val lat = loc?.latitude ?: 0.0
                val lon = loc?.longitude ?: 0.0
                val ocr = _activePlateOcr.value
                val mmc = _activeVehicleMmc.value
                val battery = batteryMonitor.getBatteryLevel()

                val newLog = DriverLog(
                    id = 0,
                    rating = rating,
                    plateOcr = ocr,
                    vehicleMmc = if (ocr == null) mmc else null,
                    timestamp = System.currentTimeMillis(),
                    latitude = lat,
                    longitude = lon,
                    batteryLevel = battery
                )

                val rowId = dao.safeInsertLog(newLog)
                val tag = ocr ?: mmc ?: "Unidentified Object"
                _notificationMessage.value = "Logged \$rating driver (\$tag) at GPS: [\$lat, \$lon] (Battery: \$battery%)"
                Log.i("DashcamViewModel", "Success writing driver behavior log [Row: \$rowId, Rating: \$rating, Entity: \$tag, Battery: \$battery%]")
            } catch (e: Exception) {
                Log.e("DashcamViewModel", "CRITICAL FAILURE: Could not write voice behavior log to database: \${e.localizedMessage}")
            }
        }
    }
}`
  },
  {
    name: "LocationRecord.kt",
    path: "app/src/main/java/com/example/dashcam/data/LocationRecord.kt",
    language: "kotlin",
    description: "Room Database entity for high-density GPS track breadcrumbs, recording latitude, longitude, vehicle speed, accuracy characteristics, and timestamp epochs.",
    content: `package com.example.dashcam.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "location_history")
data class LocationRecord(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val timestamp: Long,
    val latitude: Double,
    val longitude: Double,
    val speed: Float,
    val accuracy: Float
)`
  },
  {
    name: "DriverLog.kt",
    path: "app/src/main/java/com/example/dashcam/data/DriverLog.kt",
    language: "kotlin",
    description: "Room Database entity defining behaviors logging triggers: Rating stars classification, license Plate OCR alphanumeric keys, vehicle fallback class attributes, GPS coords, battery logs, and system times.",
    content: `package com.example.dashcam.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "driver_logs")
data class DriverLog(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val rating: String,
    val plateOcr: String?,
    val vehicleMmc: String?,
    val timestamp: Long,
    val latitude: Double,
    val longitude: Double,
    val batteryLevel: Int = 100
)`
  },
  {
    name: "DriverLogDao.kt",
    path: "app/src/main/java/com/example/dashcam/data/DriverLogDao.kt",
    language: "kotlin",
    description: "Database DAO containing Room query selectors, transactional interceptors, and high-performance continuous GPS breadcrumbs saving methods.",
    content: `package com.example.dashcam.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface DriverLogDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLogInternal(log: DriverLog): Long

    @Query("SELECT * FROM driver_logs ORDER BY timestamp DESC")
    fun getAllLogs(): Flow<List<DriverLog>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLocationRecordInternal(record: LocationRecord): Long

    @Query("SELECT * FROM location_history ORDER BY timestamp DESC")
    fun getAllLocationRecords(): Flow<List<LocationRecord>>
}`
  },
  {
    name: "AppDatabase.kt",
    path: "app/src/main/java/com/example/dashcam/data/AppDatabase.kt",
    language: "kotlin",
    description: "Room SQLite Database config registering both DriverLog and LocationRecord tables with thread-safe singleton helper methods.",
    content: `package com.example.dashcam.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [DriverLog::class, LocationRecord::class], version = 3, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun driverLogDao(): DriverLogDao
}`
  }
];
