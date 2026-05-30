package com.example.dashcam.camera

import android.content.Context
import android.graphics.*
import android.media.Image
import android.util.Log
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.example.dashcam.data.DriverLog
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.io.File
import org.tensorflow.lite.support.image.TensorImage
import org.tensorflow.lite.task.vision.detector.ObjectDetector

/**
 * Highly optimized CameraX Image Standard Analyzer running on a dedicated background thread.
 * Enforces a strict 1 FPS rate limit, targets the telephoto lens, and orchestrates the
 * YOLOv8 Object Detection, Google ML Kit OCR text parser, and secondary classification MMC pipeline.
 */
class TelephotoAnalyzer(
    private val context: Context,
    private val uiScope: CoroutineScope
) : ImageAnalysis.Analyzer {

    // Active state model to communicate currently recognized vehicle details to the main dashboard
    data class PipelineState(
        val activePlateocr: String? = null,
        val activeVehicleMmc: String? = null,
        val fpsTimestamp: Long = 0L,
        val processingTimeMs: Long = 0,
        val lastStatusMessage: String = "Pipeline Idle"
    )

    private val _pipelineState = MutableStateFlow(PipelineState())
    val pipelineState: StateFlow<PipelineState> = _pipelineState

    private var lastAnalyzedTimestamp = 0L
    private val frameDispatcher = Dispatchers.Default

    // Lazy initialization of ML Kit Latin OCR Client
    private val ocrRecognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    // Structures representing bounding box predictions
    data class Detection(
        val box: RectF,
        val label: String,  // Either "license_plate" or "vehicle"
        val confidence: Float
    )

    @OptIn(ExperimentalGetImage::class)
    override fun analyze(image: ImageProxy) {
        val currentMillis = System.currentTimeMillis()

        // 1 FPS Rate Control: Check if 1000ms has elapsed since the last processing run
        if (currentMillis - lastAnalyzedTimestamp < 1000L) {
            image.close() // Release frame back to CameraX buffer immediately
            return
        }

        // Lock timestamp for next run
        lastAnalyzedTimestamp = currentMillis

        val mediaImage = image.image ?: run {
            Log.w("TelephotoAnalyzer", "CameraX Frame skipped: media.Image payload is raw null.")
            image.close()
            return
        }

        // Offload crop translation and model interference to a background thread to prevent preview stuttering
        uiScope.launch(frameDispatcher) {
            val startTime = System.currentTimeMillis()
            try {
                // Determine orientation adjustment based on CameraX image info
                val rotationDegrees = image.imageInfo.rotationDegrees
                Log.d("TelephotoAnalyzer", "Frame received at timestamp $currentMillis. Active device sensor rotation: ${rotationDegrees}°")
                
                val origBitmap = mediaImage.toBitmap()

                // Rotate bitmap if necessary to align physically upfront matching viewport rotation events
                val bitmap = if (rotationDegrees != 0) {
                    Log.i("TelephotoAnalyzer", "Reconfiguring Frame Layout: Rotating frame matrix by ${rotationDegrees}° to match device rotation.")
                    origBitmap.rotate(rotationDegrees.toFloat())
                } else {
                    origBitmap
                }

                _pipelineState.value = _pipelineState.value.copy(
                    fpsTimestamp = currentMillis,
                    lastStatusMessage = "Analyzing Frame..."
                )

                executeHybridMlPipeline(bitmap)

                val elapsed = System.currentTimeMillis() - startTime
                Log.d("TelephotoAnalyzer", "Full Edge Inference Pipeline completed in ${elapsed}ms")
                _pipelineState.value = _pipelineState.value.copy(
                    processingTimeMs = elapsed
                )

            } catch (e: Exception) {
                Log.e("TelephotoAnalyzer", "CRITICAL PIPELINE EXCEPTION during frame analysis: ${e.localizedMessage}", e)
                _pipelineState.value = _pipelineState.value.copy(
                    lastStatusMessage = "Pipeline Error: ${e.localizedMessage}"
                )
            } finally {
                // Crudely complete the turn by closing the proxy
                image.close()
            }
        }
    }

    /**
     * Executes the hybrid pipeline flow:
     * 1. Run YOLOv8 Object Detection on full 1FPS frame.
     * 2. If 'license_plate' is detected: Crop plate -> Process via Google ML Kit Text OCR.
     * 3. If license plate is not found, OR OCR returns blank:
     *    Crop 'vehicle' -> Process via Secondary classification (Make, Model, Color).
     */
    private suspend fun executeHybridMlPipeline(frameBitmap: Bitmap) {
        _pipelineState.value = _pipelineState.value.copy(lastStatusMessage = "Step 1: Running Plate/Vehicle Detector...")
        Log.i("TelephotoAnalyzer", "Executing Step 1: Loading quantized YOLOv8 object detection model for local inference...")
        
        val detections = runYoloV8ObjectionDetection(frameBitmap)
        Log.d("TelephotoAnalyzer", "YOLOv8 completed. Detected ${detections.size} candidate bounding boxes.")

        val plateDetection = detections.firstOrNull { it.label == "license_plate" && it.confidence > 0.45f }
        val vehicleDetection = detections.firstOrNull { it.label == "vehicle" && it.confidence > 0.50f }

        if (plateDetection != null) {
            Log.i("TelephotoAnalyzer", "License plate detected with high confidence (${plateDetection.confidence}). Cropping image for OCR...")
            _pipelineState.value = _pipelineState.value.copy(lastStatusMessage = "Step 2: Cropping Plate & Running OCR...")
            val croppedPlate = cropBitmapToDetection(frameBitmap, plateDetection.box)
            if (croppedPlate != null) {
                runMlKitOcrTextRecognition(croppedPlate, frameBitmap, vehicleDetection)
            } else {
                Log.w("TelephotoAnalyzer", "Plate cropping failed due to invalid coordinates boundary. Initializing MMC classification fallback.")
                handleMmcFallback(frameBitmap, vehicleDetection)
            }
        } else {
            Log.i("TelephotoAnalyzer", "No license plate found in frame. Initiating primary Make/Model/Color (MMC) classifier fallback...")
            // No license plate detected, run Make, Model, Color (MMC) classification fallback
            handleMmcFallback(frameBitmap, vehicleDetection)
        }
    }

    /**
     * Integrates Google ML Kit on-device Latin Text Recognition on custom Plate Crop.
     */
    private fun runMlKitOcrTextRecognition(plateBitmap: Bitmap, parentFrame: Bitmap, vehicleDetection: Detection?) {
        Log.i("TelephotoAnalyzer", "Sending crop to Google ML Kit text recognizer...")
        val inputImage = InputImage.fromBitmap(plateBitmap, 0)
        ocrRecognizer.process(inputImage)
            .addOnSuccessListener { visionText ->
                val detectedText = visionText.text.trim().replace("\n", " ")
                if (detectedText.isNotEmpty()) {
                    // Normalize standard alphanumeric license formatting
                    val cleanText = detectedText.uppercase().filter { it.isLetterOrDigit() || it == ' ' }
                    Log.i("TelephotoAnalyzer", "Google ML Kit OCR matched plate digits successfully: '$cleanText'")
                    _pipelineState.value = _pipelineState.value.copy(
                        activePlateocr = cleanText,
                        activeVehicleMmc = null, // Reset inactive MMC metrics
                        lastStatusMessage = "OCR Success: $cleanText"
                    )
                } else {
                    Log.w("TelephotoAnalyzer", "ML Kit Recognizer completed but returned blank alphanumeric strings. Delegating to MMC classifier.")
                    // ML Kit returned empty/null characters. Fall back to MMC
                    handleMmcFallback(parentFrame, vehicleDetection)
                }
            }
            .addOnFailureListener { e ->
                Log.e("TelephotoAnalyzer", "ML Kit OCR inference encountered a non-fatal exception: ${e.localizedMessage}", e)
                _pipelineState.value = _pipelineState.value.copy(
                    lastStatusMessage = "OCR Failed, falling back to MMC: ${e.localizedMessage}"
                )
                handleMmcFallback(parentFrame, vehicleDetection)
            }
    }

    private fun handleMmcFallback(parentFrame: Bitmap, vehicleDetection: Detection?) {
        _pipelineState.value = _pipelineState.value.copy(lastStatusMessage = "Step 2 (Fallback): Classifying MMC...")
        val vehicleCrop = if (vehicleDetection != null) {
            Log.d("TelephotoAnalyzer", "Cropping parent canvas on detected vehicle bbox: ${vehicleDetection.box}")
            cropBitmapToDetection(parentFrame, vehicleDetection.box)
        } else {
            Log.d("TelephotoAnalyzer", "No distinct vehicle box found by YOLOv8. Evaluating full frame canvas for MMC.")
            parentFrame // Fallback to full frame context if whole vehicle was not boxed independently
        }

        if (vehicleCrop != null) {
            Log.i("TelephotoAnalyzer", "Running custom TFLite MobileNet Make, Model, Color classifier on cropped canvas matrix...")
            val mmc = runMmcClassification(vehicleCrop)
            Log.i("TelephotoAnalyzer", "MMC Classifier resolved vehicle attributes: '$mmc'")
            _pipelineState.value = _pipelineState.value.copy(
                activePlateocr = null, // OCR reset
                activeVehicleMmc = mmc,
                lastStatusMessage = "MMC Success: $mmc"
            )
        } else {
            Log.e("TelephotoAnalyzer", "Wile fallback to MMC, vehicle cropping returned null. Discarding active pipeline frames state.")
            _pipelineState.value = _pipelineState.value.copy(
                lastStatusMessage = "Both pipelines unresolved. Holding stale logs."
            )
        }
    }

    /**
     * YOLOv8 Object Detection Executor (TFLite).
     * This uses a custom quantized YOLOv8 object detection model built for Edge devices.
     */
    private fun runYoloV8ObjectionDetection(bitmap: Bitmap): List<Detection> {
        // [TFLite Model Implementation Placeholder / Demonstration]
        // 1. Create a TensorImage from the Bitmap
        // 2. Load the custom yolo_plate_detector.tflite model using Interpreter
        // 3. Process outputs: parse bounding boxes, confidence scores, and class categories
        
        // Emulating actual edge outputs:
        val results = mutableListOf<Detection>()

        // Simulating highly granular spatial boxes:
        val height = bitmap.height.toFloat()
        val width = bitmap.width.toFloat()

        // Let's mock a detection scenario simulating real live highway conditions:
        val rand = Math.random()
        if (rand > 0.4) {
            // Emulate license plate detection
            results.add(
                Detection(
                    box = RectF(width * 0.40f, height * 0.65f, width * 0.60f, height * 0.75f),
                    label = "license_plate",
                    confidence = 0.89f
                )
            )
            results.add(
                Detection(
                    box = RectF(width * 0.25f, height * 0.30f, width * 0.75f, height * 0.80f),
                    label = "vehicle",
                    confidence = 0.94f
                )
            )
        } else if (rand > 0.15) {
            // Emulate vehicle only, plate obscured/too far for YOLO detection
            results.add(
                Detection(
                    box = RectF(width * 0.20f, height * 0.25f, width * 0.80f, height * 0.85f),
                    label = "vehicle",
                    confidence = 0.82f
                )
            )
        }
        return results
    }

    /**
     * Secondary MMC Classification Model (TFLite).
     * Compares the cropped vehicle bitmap properties against a quantized MobileNet classifier
     * generating make, model, and primary color indicators.
     */
    private fun runMmcClassification(vehicleBitmap: Bitmap): String {
        // [TFLite MMC Model Implementation Placeholder / Demonstration]
        // In fully deployed production, we package an MMC classifier:
        // val tensorImage = TensorImage.fromBitmap(vehicleBitmap)
        // val model = ImageClassifier.createFromFile(context, "mmc_classifier.tflite")
        // val outputs = model.classify(tensorImage)

        // Mocking the top probability classes for demo:
        val makes = listOf("Tesla Model Y", "Toyota RAV4", "Honda Accord", "Ford F-150", "Chevrolet Silverado")
        val colors = listOf("White", "Midnight Charcoal", "Silver Metallic", "Solid Red", "Ocean Blue")

        val randomMake = makes[(vehicleBitmap.width + vehicleBitmap.height) % makes.size]
        val randomColor = colors[(vehicleBitmap.width * vehicleBitmap.height) % colors.size]

        return "$randomColor $randomMake"
    }

    /**
     * Safely clips a Bitmap boundary around the localized bounding box.
     */
    private fun cropBitmapToDetection(src: Bitmap, box: RectF): Bitmap? {
        return try {
            val left = (box.left.coerceIn(0f, src.width.toFloat())).toInt()
            val top = (box.top.coerceIn(0f, src.height.toFloat())).toInt()
            val right = (box.right.coerceIn(0f, src.width.toFloat())).toInt()
            val bottom = (box.bottom.coerceIn(0f, src.height.toFloat())).toInt()

            val width = right - left
            val height = bottom - top

            if (width > 0 && height > 0) {
                Bitmap.createBitmap(src, left, top, width, height)
            } else null
        } catch (e: Exception) {
            null
        }
    }

    // Helper extensions for format processing without quality degradation
    private fun Image.toBitmap(): Bitmap {
        val yBuffer = planes[0].buffer // Y
        val uBuffer = planes[1].buffer // U
        val vBuffer = planes[2].buffer // V

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()

        val nv21 = ByteArray(ySize + uSize + vSize)

        yBuffer.get(nv21, 0, ySize)
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)

        val yuvImage = YuvImage(nv21, ImageFormat.NV21, this.width, this.height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, this.width, this.height), 100, out)
        val imageBytes = out.toByteArray()
        return BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
    }

    private fun Bitmap.rotate(degrees: Float): Bitmap {
        val matrix = Matrix().apply { postRotate(degrees) }
        return Bitmap.createBitmap(this, 0, 0, width, height, matrix, true)
    }
}
