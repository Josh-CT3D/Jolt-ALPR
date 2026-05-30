package com.example.dashcam

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
                // Channel live analysis outputs directly to the ViewModel's state container
                lifecycleScope.launch {
                    pipelineState.collect { state ->
                        viewModel.updateActiveDetection(state.activePlateocr, state.activeVehicleMmc)
                    }
                }
            }
            android.util.Log.i("MainActivity", "TelephotoAnalyzer successfully built.")
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "CRITICAL: Failed to load ML assets or instantiate TelephotoAnalyzer: ${e.localizedMessage}", e)
            Toast.makeText(this, "ML Engine failure: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
        }

        android.util.Log.i("MainActivity", "Starting driver hands-free continuous Speech Recognizer...")
        try {
            voiceCommandListener = VoiceCommandListener(applicationContext) { rating ->
                android.util.Log.i("MainActivity", "Continuous Speech matcher matched trigger command! [Rating: $rating]")
                viewModel.handleVoiceRatingCommand(rating)
            }
            voiceCommandListener?.startListening()
            android.util.Log.i("MainActivity", "VoiceCommandListener successfully initialized and polling audio stream.")
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "CRITICAL ERROR: Speech recognizer initiation failed: ${e.localizedMessage}", e)
            Toast.makeText(this, "Speech recognizer failure: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
        voiceCommandListener?.stopListening()
    }
}

/**
 * Modern Jetpack Compose Dashcam UI Panel layout.
 */
@Composable
fun DashcamDashboardScreen(
    activeOcr: String?,
    activeMmc: String?,
    logList: List<DriverLog>,
    speechState: VoiceCommandListener.ListenerState,
    gpsLatitude: Double,
    gpsLongitude: Double,
    bannerNotification: String?,
    onDismissNotification: () -> Unit,
    onClearLogs: () -> Unit,
    onPresetTrigger: (String) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        // --- High-Status Alerts Bar ---
        AnimatedVisibility(visible = bannerNotification != null) {
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF00B0FF)),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp)
            ) {
                Row(
                    modifier = Modifier
                        .padding(12.dp)
                        .fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = bannerNotification ?: "",
                        color = Color.Black,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(
                        onClick = onDismissNotification,
                        modifier = Modifier.size(24.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Dismiss",
                            tint = Color.Black
                        )
                    }
                }
            }
        }

        // --- Driver HUD Dashboard Row ---
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1.3f),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // LEFT COLUMN: Optical Camera Viewport
            Box(
                modifier = Modifier
                    .weight(1.2f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.Black)
                    .border(1.dp, Color(0xFF333333), RoundedCornerShape(12.dp))
            ) {
                // Renders the real-time background camera preview stream via CameraX
                CameraPreviewWidget(
                    lifecycleOwner = lifecycleOwner,
                    cameraProviderFuture = ProcessCameraProvider.getInstance(context),
                    analyzer = (context as? MainActivity)?.run {
                        // Use reflection / casting helper to retrieve current analyzer context
                        javaClass.getDeclaredField("telephotoAnalyzer").apply { isAccessible = true }.get(this) as? TelephotoAnalyzer
                    }
                )

                // Lens Indicator Overlay
                Box(
                    modifier = Modifier
                        .padding(8.dp)
                        .align(Alignment.TopStart)
                        .background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(4.dp))
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .background(Color(0xFF00E676), CircleShape)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "5.0X TELEPHOTO LENS (PIXEL 10)",
                            color = Color.White,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }

            // RIGHT COLUMN: Active AI Inference Feed & Status
            Column(
                modifier = Modifier
                    .weight(0.8f)
                    .fillMaxHeight()
            ) {
                // Voice Recognition Status Panel
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1.2f)
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "VOICE ENGINE",
                            color = Color.Gray,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )
                        Spacer(modifier = Modifier.height(12.dp))

                        // Pulsing listening animation
                        val activeColor = when (speechState) {
                            is VoiceCommandListener.ListenerState.Listening -> Color(0xFF00E676)
                            is VoiceCommandListener.ListenerState.Idle -> Color.Gray
                            else -> Color(0xFFFF1744) // Error state
                        }

                        Box(
                            modifier = Modifier
                                .size(48.dp)
                                .background(activeColor.copy(alpha = 0.15f), CircleShape)
                                .border(2.dp, activeColor, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.PlayArrow,
                                contentDescription = "Mic Status",
                                tint = activeColor,
                                modifier = Modifier.size(24.dp)
                            )
                        }

                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = when (speechState) {
                                is VoiceCommandListener.ListenerState.Listening -> "CONTINUOUS LISTENING"
                                is VoiceCommandListener.ListenerState.Idle -> "VOICE ENGINE STOPPED"
                                is VoiceCommandListener.ListenerState.Error -> "RECOVERING SESSIONS"
                            },
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 11.sp,
                            textAlign = TextAlign.Center
                        )
                        Text(
                            text = "Commands: 'Log Good Driver' / 'Log Bad Driver'",
                            color = Color.Gray,
                            fontSize = 8.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Active Edge Detection Card
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1.8f)
                ) {
                    Column(
                        modifier = Modifier
                            .padding(12.dp)
                            .fillMaxSize(),
                        verticalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "ACTIVE ALPR PIPELINE",
                            color = Color.Gray,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )

                        Spacer(modifier = Modifier.height(8.dp))

                        if (activeOcr != null) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                                Box(
                                    modifier = Modifier
                                        .background(Color.White, RoundedCornerShape(4.dp))
                                        .border(2.dp, Color.Black, RoundedCornerShape(4.dp))
                                        .padding(horizontal = 16.dp, vertical = 6.dp)
                                ) {
                                    Text(
                                        text = activeOcr,
                                        color = Color.Black,
                                        fontSize = 20.sp,
                                        fontWeight = FontWeight.Bold,
                                        fontFamily = FontFamily.Monospace
                                    )
                                }
                                Text("ALPR / LICENSE PLATE OCR", color = Color(0xFF00E676), fontSize = 8.sp, modifier = Modifier.padding(top = 4.dp))
                            }
                        } else if (activeMmc != null) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                                Text(
                                    text = activeMmc,
                                    color = Color(0xFF00B0FF),
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold,
                                    textAlign = TextAlign.Center
                                )
                                Text("MMC VEHICLE CLASSIFICATION (PLATE BLIND)", color = Color.Gray, fontSize = 8.sp, modifier = Modifier.padding(top = 4.dp))
                            }
                        } else {
                            Text(
                                text = "NO VEHICLE IN VIEW\n(SCANNING ROAD)",
                                color = Color.Gray,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                textAlign = TextAlign.Center,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 12.dp)
                            )
                        }

                        // Coordinates Bar
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color.Black.copy(alpha = 0.4f), RoundedCornerShape(4.dp))
                                .padding(6.dp),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "LAT: ${String.format("%.5f", gpsLatitude)}",
                                color = Color.LightGray,
                                fontSize = 8.sp,
                                fontFamily = FontFamily.Monospace
                            )
                            Text(
                                text = "LON: ${String.format("%.5f", gpsLongitude)}",
                                color = Color.LightGray,
                                fontSize = 8.sp,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // --- Historic Log Registry ---
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier
                .fillMaxWidth()
                .weight(1.5f)
        ) {
            Column(
                modifier = Modifier
                    .padding(16.dp)
                    .fillMaxSize()
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.DateRange,
                            contentDescription = "Log History",
                            tint = Color.Gray
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "DRIVER-RATING LOGS (LOCAL ROOM)",
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace
                        )
                    }

                    if (logList.isNotEmpty()) {
                        Button(
                            onClick = onClearLogs,
                            colors = ButtonDefaults.buttonColors(containerColor = Color.DarkGray),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                            modifier = Modifier.height(28.dp)
                        ) {
                            Text("Clear", fontSize = 10.sp, color = Color.White)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                if (logList.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .border(1.dp, Color(0xFF2B2B2B), RoundedCornerShape(8.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "No driving logs recorded yet.\nSpeak 'Log Good Driver' or 'Log Bad Driver' to log events.",
                            color = Color.Gray,
                            fontSize = 11.sp,
                            textAlign = TextAlign.Center
                        )
                    }
                } else {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxSize()
                    ) {
                        items(logList) { log ->
                            DriverLogItemWidget(log = log)
                        }
                    }
                }
            }
        }

        // --- Trigger Preview Controls (Manual buttons for test backup) ---
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Button(
                onClick = { onPresetTrigger("GOOD") },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00E676)),
                modifier = Modifier.weight(1f)
            ) {
                Text("Simulate: 'GOOD'", color = Color.Black, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            }
            Button(
                onClick = { onPresetTrigger("BAD") },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF1744)),
                modifier = Modifier.weight(1f)
            ) {
                Text("Simulate: 'BAD'", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            }
        }
    }
}

/**
 * CameraX Preview View Adapter.
 * Integrates camera preview binding and inserts TelephotoAnalyzer processing frame hooks.
 */
@OptIn(ExperimentalCamera2Interop::class)
@Composable
fun CameraPreviewWidget(
    lifecycleOwner: androidx.lifecycle.LifecycleOwner,
    cameraProviderFuture: ListenableFuture<ProcessCameraProvider>,
    analyzer: TelephotoAnalyzer?
) {
    AndroidView(
        factory = { ctx ->
            android.util.Log.i("CameraPreviewWidget", "Constructing viewfinder instance. Initializing target orientation listeners...")
            val previewView = PreviewView(ctx)
            val executor = ContextCompat.getMainExecutor(ctx)

            cameraProviderFuture.addListener({
                try {
                    val cameraProvider = cameraProviderFuture.get()

                    // Configure standard Viewfinder Preview
                    val preview = Preview.Builder().build().apply {
                        setSurfaceProvider(previewView.surfaceProvider)
                    }

                    // Configure Rate-Limited Frame analyzer execution
                    val imageAnalysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()

                    if (analyzer != null) {
                        imageAnalysis.setAnalyzer(executor, analyzer)
                    }

                    // Register Physical Board Orientation Sensor to notify CameraX of rotation events dynamically
                    val orientationEventListener = object : android.view.OrientationEventListener(ctx) {
                        override fun onOrientationChanged(orientation: Int) {
                            if (orientation == ORIENTATION_UNKNOWN) return
                            val rotation = when (orientation) {
                                in 45 until 135 -> android.view.Surface.ROTATION_270
                                in 135 until 225 -> android.view.Surface.ROTATION_180
                                in 225 until 315 -> android.view.Surface.ROTATION_90
                                else -> android.view.Surface.ROTATION_0
                            }
                            try {
                                preview.targetRotation = rotation
                                imageAnalysis.targetRotation = rotation
                                android.util.Log.v("CameraPreviewWidget", "Device rotation listener alert: rotated to degree mapping: $rotation")
                            } catch (e: Exception) {
                                android.util.Log.w("CameraPreviewWidget", "Failed applying target rotation to CameraX pipeline: ${e.localizedMessage}")
                            }
                        }
                    }
                    orientationEventListener.enable()

                    // Try to attach orientation listener lifetime to the View's attach/detach events
                    previewView.addOnAttachStateChangeListener(object : android.view.View.OnAttachStateChangeListener {
                        override fun onViewAttachedToWindow(v: android.view.View) {
                            orientationEventListener.enable()
                            android.util.Log.i("CameraPreviewWidget", "Viewfinder Attached. Orientation Sensor Listener enabled.")
                        }
                        override fun onViewDetachedFromWindow(v: android.view.View) {
                            orientationEventListener.disable()
                            android.util.Log.i("CameraPreviewWidget", "Viewfinder Detached. Orientation Sensor Listener disabled.")
                        }
                    })

                    // --- Pixel 10 Physical 5x Telephoto Camera Targeting ---
                    val telephotoSelector = findTelephotoCameraSelector(cameraProvider)
                    android.util.Log.i("CameraPreviewWidget", "Evaluating rear optical lens properties. Resolving Telephoto characteristics parameters...")

                    try {
                        // Reset existing attachments and bind the pipeline
                        cameraProvider.unbindAll()
                        val camera = cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            telephotoSelector,
                            preview,
                            imageAnalysis
                        )

                        // Optional fallback: If the multi-camera logical back lens was bound, enforce 5.0x optical zoom ratio programmatically
                        camera.cameraControl.setZoomRatio(5.0f)
                        android.util.Log.i("CameraPreviewWidget", "Successfully bound CameraX lifecycle to physical optical Telephoto lens selection with 5.0x zoom multiplier.")

                    } catch (e: Exception) {
                        android.util.Log.e("CameraPreviewWidget", "Telephoto binding failed: ${e.localizedMessage}. Falling back to default rear lens.", e)
                        // Fallback configuration if telephoto constraints are unavailable
                        try {
                            cameraProvider.unbindAll()
                            cameraProvider.bindToLifecycle(
                                lifecycleOwner,
                                CameraSelector.DEFAULT_BACK_CAMERA,
                                preview,
                                imageAnalysis
                            )
                            android.util.Log.i("CameraPreviewWidget", "Successfully bound CameraX to DEFAULT back camera selector fallback.")
                        } catch (fallbackEx: Exception) {
                            android.util.Log.e("CameraPreviewWidget", "CRITICAL ERROR: Failed to bind default back camera selector: ${fallbackEx.localizedMessage}", fallbackEx)
                        }
                    }
                } catch (instaneEx: Exception) {
                    android.util.Log.e("CameraPreviewWidget", "Failed bringing up ProcessCameraProvider: ${instaneEx.localizedMessage}", instaneEx)
                }
            }, executor)

            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}

/**
 * Iterates through system cameras, detecting Google Pixel 10 physical optical Telephoto identifiers
 * by comparing LENS_FACING and Focal Length structures in a safe pipeline.
 */
@OptIn(ExperimentalCamera2Interop::class)
private fun findTelephotoCameraSelector(cameraProvider: ProcessCameraProvider): CameraSelector {
    for (cameraInfo in cameraProvider.availableCameraInfos) {
        val characteristics = Camera2CameraInfo.from(cameraInfo).cameraCharacteristics
        val lensFacing = characteristics.get(CameraCharacteristics.LENS_FACING)

        if (lensFacing == CameraCharacteristics.LENS_FACING_BACK) {
            // Read hardware supported focal lengths
            val focalLengths = characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
            // Pixel 10 standard wide lens sits ~6.5mm focal length. Physical telephoto is typically > 7.0mm
            if (focalLengths != null && focalLengths.any { it >= 7.0f }) {
                return cameraInfo.cameraSelector
            }
        }
    }
    return CameraSelector.DEFAULT_BACK_CAMERA
}

/**
 * Renders individual logged driver record items.
 */
@Composable
fun DriverLogItemWidget(log: DriverLog) {
    val ratingColor = if (log.rating == "GOOD") Color(0xFF00E676) else Color(0xFFFF1744)
    val formattedDate = remember(log.timestamp) {
        val sdf = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
        sdf.format(Date(log.timestamp))
    }

    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF262626)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .padding(12.dp)
                .fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            // Rating Tag
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .background(ratingColor, CircleShape)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = log.rating,
                    color = ratingColor,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace
                )
            }

            // Description: Plate OCR or Vehicle MMC characteristics
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 16.dp)
            ) {
                if (log.plateOcr != null) {
                    Text(
                        text = "Plate: ${log.plateOcr}",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        fontFamily = FontFamily.Monospace
                    )
                } else {
                    Text(
                        text = log.vehicleMmc ?: "Unidentified Object",
                        color = Color.LightGray,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.sp
                    )
                }
                Text(
                    text = "GPS: [${String.format("%.4f", log.latitude)}, ${String.format("%.4f", log.longitude)}]",
                    color = Color.Gray,
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace
                )
            }

            // Timestamp
            Text(
                text = formattedDate,
                color = Color.Gray,
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace
            )
        }
    }
}
