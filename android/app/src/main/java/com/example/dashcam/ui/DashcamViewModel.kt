package com.example.dashcam.ui

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

/**
 * Clean MVVM Architecture Controller.
 * Manages background Room inserts, hooks FusedLocationProviderClient to stream coordinates continuously,
 * and tracks the active ALPR metrics emitted by the Frame Analyzer.
 */
class DashcamViewModel(application: Application) : AndroidViewModel(application) {

    private val db = AppDatabase.getDatabase(application)
    private val dao = db.driverLogDao()
    private val batteryMonitor = BatteryMonitor(application)

    // Query active logs via Room flow, instantly binding to standard Jetpack Composables
    val logsList: StateFlow<List<DriverLog>> = dao.getAllLogs()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000L), emptyList())

    // Direct continuous GPS tracking records flow
    val locationHistoryList: StateFlow<List<LocationRecord>> = dao.getAllLocationRecords()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000L), emptyList())

    // Tracks current device coordinates
    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(application)

    private val _currentLocation = MutableStateFlow<Location?>(null)
    val currentLocation: StateFlow<Location?> = _currentLocation

    // Reference to Active OCR/MMC values bound to the most recent 1 FPS frame execution
    private val _activePlateOcr = MutableStateFlow<String?>(null)
    val activePlateOcr: StateFlow<String?> = _activePlateOcr

    private val _activeVehicleMmc = MutableStateFlow<String?>(null)
    val activeVehicleMmc: StateFlow<String?> = _activeVehicleMmc

    private val _notificationMessage = MutableStateFlow<String?>(null)
    val notificationMessage: StateFlow<String?> = _notificationMessage

    // Continuous location tracking callback
    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(locationResult: LocationResult) {
            super.onLocationResult(locationResult)
            val location = locationResult.lastLocation ?: return
            _currentLocation.value = location
            Log.d("DashcamViewModel", "Continuous Location captured: lat=${location.latitude}, lon=${location.longitude}")

            // Log coordinate track points to detailed location history
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
                    Log.e("DashcamViewModel", "Database write failed during continuous GPS log: ${e.localizedMessage}", e)
                }
            }
        }
    }

    init {
        Log.i("DashcamViewModel", "Initializing Dashcam ViewModel. Launching telemetry providers...")
        // Fetch updated one-off cache coordinates
        fetchUpdatedLocation()
        // Register continuous high-precision GPS coordinate tracks
        startLocationUpdates()
    }

    /**
     * Updates the internal active tracking strings which are logged when a voice trigger is declared.
     */
    fun updateActiveDetection(plateOcr: String?, vehicleMmc: String?) {
        _activePlateOcr.value = plateOcr
        _activeVehicleMmc.value = vehicleMmc
    }

    /**
     * Resolves coordinates from Location Services before writing logs to Room.
     */
    @SuppressLint("MissingPermission")
    fun fetchUpdatedLocation() {
        try {
            fusedLocationClient.getCurrentLocation(
                Priority.PRIORITY_HIGH_ACCURACY,
                CancellationTokenSource().token
            ).addOnSuccessListener { location ->
                if (location != null) {
                    _currentLocation.value = location
                    Log.i("DashcamViewModel", "Ad-hoc location query success: [${location.latitude}, ${location.longitude}]")
                }
            }.addOnFailureListener { e ->
                Log.w("DashcamViewModel", "FusedLocationProvider.getCurrentLocation query failed: ${e.localizedMessage}", e)
            }
        } catch (e: SecurityException) {
            Log.e("DashcamViewModel", "SecurityException: Location permissions are missing in FusedLocationProviderClient.", e)
            _notificationMessage.value = "GPS Permission absent. Logs saved at coordinates (0,0)."
        } catch (e: Exception) {
            Log.e("DashcamViewModel", "Ad-hoc location resolution failed: ${e.localizedMessage}", e)
        }
    }

    /**
     * Registers a high-frequency coordinate updater with our callback receiver.
     */
    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        try {
            val locationRequest = LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                5000L // Query high accuracy location coordinate interval: every 5 seconds
            ).apply {
                setMinUpdateIntervalMillis(2000L)
            }.build()

            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                android.os.Looper.getMainLooper()
            )
            Log.i("DashcamViewModel", "Registered continuous location updater callback successfully (5s interval).")
        } catch (e: SecurityException) {
            Log.e("DashcamViewModel", "CRITICAL: Location permission denied. Continuous GPS mapping unavailable.", e)
            _notificationMessage.value = "GPS permission absent. Coordinates history disabled."
        } catch (e: Exception) {
            Log.e("DashcamViewModel", "Error starting continuous GPS updates: ${e.localizedMessage}", e)
        }
    }

    /**
     * Inserts a logging row on a background thread when Voice Command callbacks are received.
     */
    fun handleVoiceRatingCommand(rating: String) {
        viewModelScope.launch {
            try {
                // Re-poll the physical GPS for fresh, precise coordinates before storing
                fetchUpdatedLocation()

                val loc = _currentLocation.value
                val lat = loc?.latitude ?: 0.0
                val lon = loc?.longitude ?: 0.0

                // Capture the exact detection cache registered at the instant of calling
                val ocr = _activePlateOcr.value
                val mmc = _activeVehicleMmc.value

                val battery = batteryMonitor.getBatteryLevel()

                val newLog = DriverLog(
                    id = 0,
                    rating = rating,
                    plateOcr = ocr,
                    vehicleMmc = if (ocr == null) mmc else null, // Enforce OCR superiority per specs
                    timestamp = System.currentTimeMillis(),
                    latitude = lat,
                    longitude = lon,
                    batteryLevel = battery
                )

                val rowId = dao.safeInsertLog(newLog)
                val tag = ocr ?: mmc ?: "Unidentified Object"
                _notificationMessage.value = "Logged $rating driver ($tag) at GPS: [$lat, $lon] (Battery: $battery%)"
                Log.i("DashcamViewModel", "Success writing driver behavior log [Row: $rowId, Rating: $rating, Entity: $tag, Battery: $battery%]")
            } catch (e: Exception) {
                Log.e("DashcamViewModel", "CRITICAL FAILURE: Could not write voice behavior log to database: ${e.localizedMessage}", e)
                _notificationMessage.value = "Database Write Failure: ${e.localizedMessage}"
            }
        }
    }

    fun deleteLogItem(log: DriverLog) {
        viewModelScope.launch {
            try {
                dao.safeDeleteLog(log)
            } catch (e: Exception) {
                Log.e("DashcamViewModel", "Failed to delete log ${log.id}: ${e.localizedMessage}", e)
            }
        }
    }

    fun clearLogs() {
        viewModelScope.launch {
            try {
                dao.safeClearAllLogs()
                dao.safeClearAllLocationRecords()
                _notificationMessage.value = "Local database sessions cleared successfully."
            } catch (e: Exception) {
                Log.e("DashcamViewModel", "Failed to wipe local SQLite database tables: ${e.localizedMessage}", e)
            }
        }
    }

    fun dismissNotification() {
        _notificationMessage.value = null
    }

    override fun onCleared() {
        super.onCleared()
        try {
            fusedLocationClient.removeLocationUpdates(locationCallback)
            Log.i("DashcamViewModel", "Continuous GPS location callback removed. Shutdown clean.")
        } catch (e: Exception) {
            Log.e("DashcamViewModel", "Failed to detach continuous GPS listener callback client on ViewModel clear: ${e.localizedMessage}", e)
        }
    }
}
