/**
 * Helper utilities to convert logs and export them to Google Drive or via Email.
 */

interface LocalLog {
  id: string;
  rating: "GOOD" | "BAD";
  plateOcr: string | null;
  vehicleMmc: string | null;
  timestamp: number;
  latitude: number;
  longitude: number;
  batteryLevel: number;
}

/**
 * Formats lists of driver logs into a CSV string format.
 */
export function convertLogsToCSV(logs: LocalLog[]): string {
  if (logs.length === 0) {
    return "ID,Rating,Plate OCR,Vehicle MMC,Timestamp,Local Time,Latitude,Longitude,Battery Level (%)\n";
  }

  const headers = ["ID", "Rating", "Plate OCR", "Vehicle MMC", "Timestamp", "Local Time", "Latitude", "Longitude", "Battery Level (%)"];
  const rows = logs.map(log => {
    const formattedTime = new Date(log.timestamp).toISOString().replace(/"/g, '""');
    return [
      log.id,
      log.rating,
      log.plateOcr || "N/A",
      log.vehicleMmc || "N/A",
      log.timestamp,
      formattedTime,
      log.latitude.toFixed(6),
      log.longitude.toFixed(6),
      log.batteryLevel
    ].map(val => {
      const strVal = String(val);
      // Escape commas & quotes
      if (strVal.includes(",") || strVal.includes('"') || strVal.includes("\n")) {
        return `"${strVal.replace(/"/g, '""')}"`;
      }
      return strVal;
    });
  });

  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

/**
 * Formats driving logs to a detailed JSON string representation.
 */
export function convertLogsToJSON(logs: LocalLog[]): string {
  return JSON.stringify(logs, null, 2);
}

/**
 * Performs a client-side Google Drive Multipart Upload.
 * Creates a file on the user's personal Google Drive using the access token.
 */
export async function uploadToGoogleDrive(
  accessToken: string,
  filename: string,
  content: string,
  mimeType: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const metadata = {
    name: filename,
    mimeType: mimeType,
  };

  const boundary = "314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body = 
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n\r\n` +
    content +
    closeDelimiter;

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: body,
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Drive API returned status ${response.status}: ${errText}`);
  }

  return response.json();
}

/**
 * Prepares a 'mailto' scheme URL configuration.
 * Generates email content with pre-formatted tabular body that works seamlessly
 * inside default mobile email clients.
 */
export function generateEmailUrl(logs: LocalLog[], fileType: "CSV" | "JSON"): string {
  const subject = encodeURIComponent("Jolt Logging Register: Active Driver Logs Export");
  
  let bodyText = "Hello,\n\nPlease find your driving logs export below. All data was successfully run and generated locally on the phone's hardware with total local privacy.\n\n";
  
  if (fileType === "CSV") {
    bodyText += "======== CSV DATA EXPORT ========\n";
    bodyText += convertLogsToCSV(logs);
  } else {
    bodyText += "======== JSON DATA EXPORT ========\n";
    bodyText += convertLogsToJSON(logs);
  }
  
  bodyText += "\n\n================================\nGenerated automatically via Jolt (Pixel 10 Edge-AI App).";

  const body = encodeURIComponent(bodyText);
  return `mailto:?subject=${subject}&body=${body}`;
}
